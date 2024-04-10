#!/bin/bash

main() {
    local id="$1"
    local input_text
    local input_file_path
    # local file_name
    local output_file_name
    local BUCKET_NAME="fovus-data-store"
    local TABLE_NAME="fovus-upload-files"

    # Retrieve data from DynamoDB using AWS CLI
    input_file_path=$(aws dynamodb get-item --table-name ${TABLE_NAME} --key '{"id": {"S": "'"$id"'"}}' --query 'Item.input_file_path.S' --region 'us-east-2')
    input_text=$(aws dynamodb get-item --table-name ${TABLE_NAME} --key '{"id": {"S": "'"$id"'"}}' --query 'Item.input_text.S' --region 'us-east-2')
    input_text=${input_text//\"}
    input_file_path=${input_file_path//\"}

    # Extract file name from the path prepare to rename file
    # file_name=$(basename "${input_file_path}")
    # output_file_name="${file_name}-output.txt"
    output_file_name="output.txt"

    # Append input_text to the end of the file from S3
    aws s3 cp "s3://${input_file_path}" "${output_file_name}"
    echo "${input_text}" >> "./${output_file_name}"

    # Upload modified file back to S3
    aws s3 cp "${output_file_name}" "s3://${BUCKET_NAME}/${output_file_name}"
    # Insert or update into DynamoDB with the output file path
    aws dynamodb put-item --table-name ${TABLE_NAME} --item '{"id": {"S": "'"${id}-1"'"}, "output_file_path": {"S": "'"${BUCKET_NAME}/${output_file_name}"'"}}' --region 'us-east-2'

    # Terminate the instance
    sudo shutdown -P now
}

main "$1"
