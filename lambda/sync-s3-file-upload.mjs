const {DynamoDBClient} = require("@aws-sdk/client-dynamodb");
const {DynamoDBDocumentClient, PutCommand} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event, context) => {  
  const response = {
      statusCode: 200,
      headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Headers" : "Content-Type",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "PUT"
      },
      body: {},
  };

  try {
    switch (event.routeKey) {
      case "PUT /upload":
        let requestJSON = JSON.parse(event.body);
        await dynamo.send(
          new PutCommand({
            TableName: `${TABLE_NAME}`,
            Item: {
              id: requestJSON.id,
              input_text: requestJSON.inputText,
              input_file_path: requestJSON.inputFilePath
            },
          })
        );
        response.body = `Put item ${requestJSON.id}`;
        break;
      default:
        throw new Error(`Unsupported route: "${event.routeKey}"`);
    }
  } catch (err) {
    response.statusCode = 400;
    response.body = err.message;
  } finally {
    response.body = JSON.stringify(response.body);
  }
  return response;
};