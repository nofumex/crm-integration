import { describe, expect, it, vi } from "vitest";
import { SafeMediaDownloader } from "../src/media/safe-downloader.js";
import { S3MediaStore } from "../src/media/s3-media-store.js";

describe("safe media pipeline",()=>{
  it("rejects non-HTTPS, private IPs and oversized streaming bodies before storage",async()=>{
    const transport=vi.fn(async()=>new Response(new Uint8Array(20),{headers:{"content-type":"image/png"}}));
    const downloader=new SafeMediaDownloader({maxBytes:10,timeoutMs:1000,allowedHosts:["8.8.8.8","127.0.0.1"],transport});
    await expect(downloader.download("http://8.8.8.8/file")).rejects.toThrow("HTTPS");
    await expect(downloader.download("https://127.0.0.1/file")).rejects.toThrow("Private");
    await expect(downloader.download("https://8.8.8.8/file")).rejects.toThrow("size limit");
  });
  it("enforces size/MIME and malware scanning before S3",async()=>{
    const scanner={scan:vi.fn(async()=>{throw new Error("malware detected");})};
    const store=new S3MediaStore({client:{send:vi.fn()} as any,bucket:"b",urlTtlSeconds:900,maxBytes:3,downloader:{} as any,scanner});
    await expect(store.put({data:Buffer.from("1234"),kind:"file",sourceId:"x"})).rejects.toThrow("size limit");
    await expect(store.put({data:Buffer.from("1"),kind:"image",mimeType:"application/pdf",sourceId:"x"})).rejects.toThrow("MIME");
    await expect(store.put({data:Buffer.from("1"),kind:"image",mimeType:"image/png",sourceId:"x"})).rejects.toThrow("malware");
    expect((store as any).options.client.send).not.toHaveBeenCalled();
  });
});
