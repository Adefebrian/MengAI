// S3-compatible object storage client (s3.datacenter.jalgroup.id), lazily
// constructed. The AWS SDK v3 client does not open a connection at
// construction time, only when a command is actually sent, so this is safe
// to import with no credentials configured.
import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

export function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? "https://s3.datacenter.jalgroup.id",
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

export function getBucket(): string {
  return process.env.S3_BUCKET ?? "app";
}
