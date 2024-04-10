import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import * as fs from 'fs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { KeyPair } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import {
  AMI_ID,
  BUCKET_NAME,
  INSTANCE_TYPE,
  TABLE_NAME,
} from './fovus-aws-config';
import * as assets from 'aws-cdk-lib/aws-s3-assets';
import { PartitionKey } from 'aws-cdk-lib/aws-appsync';

export class FovusAwsCdkSetupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const AccountId = cdk.Stack.of(this).account;
    const Region = cdk.Stack.of(this).region;

    
    const role = new iam.Role(this, 'role', {
      roleName: 'fovus-ec2-exec-role',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ec2:RunInstances',
          // 'ec2:DescribeInstances',
          // 'ec2:TerminateInstances',
          // 'ec2:CreateNetworkInterface',
          "ec2:DescribeInstances",
          "ec2:DescribeImages",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeKeyPairs",
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:CreateSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:CreateKeyPair",
          "ec2:AssociateIamInstanceProfile",
          "ec2:ReplaceIamInstanceProfileAssociation",
          'iam:PassRole',
        ],
        resources: ['*'],
      })
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:ListBucketVersions',
          's3:GetBucketLocation',
        ],
        resources: ['*'],
      })
    );

    // Add shell script to S3
    const fileAsset = new assets.Asset(this, 'file_process_script', {
      path: path.join(__dirname, 'file_process_script.sh'),
    });

    // S3 Bucket
    const S3Bucket = new cdk.aws_s3.Bucket(this, `${BUCKET_NAME}`, {
      bucketName: `${BUCKET_NAME}`,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: {
        blockPublicPolicy: false,
        blockPublicAcls: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: true,
      },
      cors: [
        {
          allowedMethods: [
            cdk.aws_s3.HttpMethods.GET,
            cdk.aws_s3.HttpMethods.PUT,
            cdk.aws_s3.HttpMethods.POST,
            cdk.aws_s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });
    S3Bucket.grantReadWrite(role);

    // DynamoDB Table
    const DynamoTable = new dynamodb.TableV2(this, 'GlobalTable', {
      tableName: `${TABLE_NAME}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    DynamoTable.grantReadWriteData(role);

    // Lambda function
    const PreFileUploadLambda = new lambda.Function(
      this,
      'PreFileUploadLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(
          fs.readFileSync('./lambda/sync-s3-file-upload.mjs', 'utf8')
        ),
        environment: {
          TABLE_NAME: DynamoTable.tableName,
        },
      }
    );

    // API Gateway config
    const api = new apigateway.LambdaRestApi(this, 'upload-api', {
      handler: PreFileUploadLambda,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });
    const items = api.root.addResource('items');
    items.addMethod('GET');
    items.addMethod('PUT');
    const item = items.addResource('{item}');
    item.addMethod('GET');
    item.addMethod('DELETE');

    // EC2 Key Pair
    const EC2KeyPair = new KeyPair(this, 'KeyPair', {
      keyPairName: 'fovus-key-pair',
      type: ec2.KeyPairType.RSA,
    });

    // EC2 Instance Profile to attach to the EC2 instance
    const EC2RoleInstanceProfile = new iam.InstanceProfile(this, 'InstanceProfile', {
      instanceProfileName: `${role.roleName}-ip`,
      role: role,
    });

    // Post file upload Lambda function
    const PostFileUploadLambda = new lambda.Function(
      this,
      'PostFileUploadLambda',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(
          fs.readFileSync('./lambda/post-file-upload-process.mjs', 'utf8')
        ),
        environment: {
          SCRIPT_PATH: fileAsset.s3ObjectUrl,
          REGION: Region,
          INSTANCE_TYPE: INSTANCE_TYPE,
          INSTANCE_ROLE_ARN: EC2RoleInstanceProfile.instanceProfileArn,
          IMAGE_ID: AMI_ID,
          KEY_NAME: EC2KeyPair.keyPairName,
          IAM_ROLE_NAME: role.roleName,
          ACCOUNT_ID: AccountId,
        },
      }
    );

    // Add DynamoDB stream event source to the Lambda function
    PostFileUploadLambda.addEventSource(
      new eventsources.DynamoEventSource(DynamoTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 1,
        bisectBatchOnError: true,
        retryAttempts: 2,
      })
    );

    // Grant necessary permissions to the Lambda functionion
    PostFileUploadLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [DynamoTable.tableArn],
      })
    );

    // Grant EC2 permissions to the Lambda function
    PostFileUploadLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:RunInstances',
          'ec2:DescribeInstances',
          'ec2:TerminateInstances',
          'ec2:CreateNetworkInterface',
          'iam:PassRole',
        ],
        resources: ['*'], // Replace with specific EC2 resource ARNs if needed
      })
    );
  }
}
