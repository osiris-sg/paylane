/**
 * Upload a File straight to S3 via a presigned PUT URL and return the stored
 * object key (to save in a row's `fileUrl`). Pass the
 * `api.storage.createUploadUrl.useMutation().mutateAsync` from the component.
 */
export async function uploadViaPresignedPut(
  file: File,
  kind: "invoices" | "statements",
  createUploadUrl: (input: {
    kind: "invoices" | "statements";
    contentType: string;
  }) => Promise<{ key: string; url: string }>,
): Promise<string> {
  const contentType = file.type || "application/octet-stream";
  const { key, url } = await createUploadUrl({ kind, contentType });
  const res = await fetch(url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status})`);
  }
  return key;
}
