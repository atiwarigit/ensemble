import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { storedFiles } from "@/db/schema/files";
import { invalid, notFound, type ServiceContext } from "./context";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Callers must have checked access to whatever the file is attached to. */
export async function storeFile(
  exec: Executor,
  ctx: ServiceContext,
  input: { filename: string; contentType: string; bytes: Uint8Array },
) {
  if (input.bytes.byteLength === 0) throw invalid("The file is empty.");
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw invalid("Files must be 10 MB or smaller.");
  const [file] = await exec
    .insert(storedFiles)
    .values({
      workspaceId: ctx.workspaceId,
      filename: input.filename.slice(0, 200) || "file",
      contentType: input.contentType || "application/octet-stream",
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      data: Buffer.from(input.bytes),
      createdBy: ctx.userId,
    })
    .returning({
      id: storedFiles.id,
      filename: storedFiles.filename,
      contentType: storedFiles.contentType,
      sizeBytes: storedFiles.sizeBytes,
      sha256: storedFiles.sha256,
    });
  return file;
}

export async function readFile(exec: Executor, ctx: ServiceContext, fileId: string) {
  const [file] = await exec
    .select()
    .from(storedFiles)
    .where(and(eq(storedFiles.id, fileId), eq(storedFiles.workspaceId, ctx.workspaceId)));
  if (!file) throw notFound("File not found.");
  return file;
}
