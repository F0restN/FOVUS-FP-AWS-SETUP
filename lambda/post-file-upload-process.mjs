const { EC2Client, RunInstancesCommand } = require("@aws-sdk/client-ec2");

const SCRIPT_PATH = process.env.SCRIPT_PATH;
const REGION = process.env.REGION;
const INSTANCE_TYPE = process.env.INSTANCE_TYPE;
const INSTANCE_ROLE_ARN = process.env.INSTANCE_ROLE_ARN;
const AMI_ID = process.env.IMAGE_ID;
const KEY_NAME = process.env.KEY_NAME;
const IAM_ROLE_NAME = process.env.IAM_ROLE_NAME;
const ACCOUNT_ID = process.env.ACCOUNT_ID;

const EC2 = new EC2Client({ region: REGION });

exports.handler = async (event) => {
    try {
        for (const record of event.Records) {
            if (record.eventName === 'INSERT' && record.dynamodb.NewImage.input_text) {
                const inputId = record.dynamodb.NewImage.id.S;
                
                if(!inputId){
                    return {statusCode: 404, message: "No input file ID", body: null};
                }
                
                const initScript = `
                    #! /bin/bash
                    aws s3 cp ${SCRIPT_PATH} /tmp/script.sh
                    chmod +x /tmp/script.sh
                    /tmp/script.sh ${inputId}
                `;
                const initScriptEncoded = new Buffer(initScript).toString('base64');
            
                // Create an EC2 instance with init config to download and run script
                const response = await EC2.send(new RunInstancesCommand({
                    UserData: initScriptEncoded,
                    KeyName: KEY_NAME,
                    ImageId: AMI_ID,
                    InstanceType: INSTANCE_TYPE,
                    Monitoring: {
                        Enabled: true
                    },
                    SecurityGroups: ['launch-wizard-2'],
                    InstanceInitiatedShutdownBehavior: 'terminate',
                    IamInstanceProfile: {
                        Arn: INSTANCE_ROLE_ARN
                    },
                    MinCount: 1,
                    MaxCount: 1,
                }));
                
                if(!response.Instances || response.Instances.length <= 0){
                    return { statusCode: 503, message: "Failed creating EC2 instance", body: response};   
                }
                
                return {statusCode: 200, message: "Execution successfully", body: response};
            }
        }
    } catch (error) {
        console.error('Error:', error);
        return {statusCode: 500, message: "Error Launching EC2, input file left unprocessed", body: error};
    }
};