/**
 * A stand-in for the bucket, for Playwright only.
 *
 * Speaks just enough S3 over plain HTTP for the app's storage code and the
 * browser's presigned PUTs: path-style `/<bucket>/<key>`, PUT stores the
 * bytes, HEAD reports their size, GET returns them, OPTIONS answers the CORS
 * preflight the way a real bucket's CORS rule must (PUT with a Content-Type
 * header from the app's origin). Signatures are not checked — this proves
 * the pipeline's mechanics, not a provider's auth.
 */
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type StoredObject = { body: Buffer; contentType: string; modifiedAt: Date };

export type S3Stub = {
  url: string;
  bucket: string;
  objects: Map<string, StoredObject>;
  close: () => Promise<void>;
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-amz-content-sha256, x-amz-date, x-amz-user-agent, authorization",
  "Access-Control-Expose-Headers": "ETag, Content-Length",
  "Access-Control-Max-Age": "600",
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startS3Stub(port: number, bucket = "stead-e2e"): Promise<S3Stub> {
  const objects = new Map<string, StoredObject>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const [, reqBucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const send = (status: number, headers: Record<string, string> = {}, body?: Buffer) => {
      res.writeHead(status, { ...CORS, ...headers });
      res.end(body);
    };

    if (req.method === "OPTIONS") {
      send(204, { "Content-Length": "0" });
      return;
    }
    if (reqBucket !== bucket || !key) {
      send(404, { "Content-Type": "application/xml" }, Buffer.from("<Error><Code>NoSuchBucket</Code></Error>"));
      return;
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      const contentType = String(req.headers["content-type"] ?? "application/octet-stream");
      objects.set(key, { body, contentType, modifiedAt: new Date() });
      send(200, { ETag: `"${createHash("md5").update(body).digest("hex")}"`, "Content-Length": "0" });
      return;
    }
    const found = objects.get(key);
    if (req.method === "HEAD" || req.method === "GET") {
      if (!found) {
        send(404, { "Content-Type": "application/xml", "Content-Length": "0" });
        return;
      }
      const headers = {
        "Content-Type": found.contentType,
        "Content-Length": String(found.body.length),
        ETag: `"${createHash("md5").update(found.body).digest("hex")}"`,
        "Last-Modified": found.modifiedAt.toUTCString(),
        "Accept-Ranges": "bytes",
      };
      if (req.method === "HEAD") send(200, headers);
      else send(200, headers, found.body);
      return;
    }
    send(405, { Allow: "GET, PUT, HEAD, OPTIONS", "Content-Length": "0" });
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      res.writeHead(500, CORS);
      res.end(String(err));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        bucket,
        objects,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
