// Concrete ObjectStorePort adapter, wrapping the lazily-constructed S3
// client in ../../lib/s3. Importing this module never opens a connection;
// only an actual command does, so it is always safe under `bun test`.
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getBucket, getS3 } from "../../lib/s3";
import type { ObjectStorePort } from "../ports/s3";

export function createS3ObjectStoreAdapter(): ObjectStorePort {
  return {
    async putObject(key: string, body: string | Uint8Array): Promise<void> {
      await getS3().send(
        new PutObjectCommand({ Bucket: getBucket(), Key: key, Body: body }),
      );
    },
    async getObject(key: string): Promise<string | null> {
      try {
        const result = await getS3().send(
          new GetObjectCommand({ Bucket: getBucket(), Key: key }),
        );
        return (await result.Body?.transformToString()) ?? null;
      } catch {
        return null;
      }
    },
  };
}
