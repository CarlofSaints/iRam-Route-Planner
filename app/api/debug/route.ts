import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    // List ALL blobs in the store
    const { blobs } = await list();
    const blobInfo = blobs.map((b) => ({
      pathname: b.pathname,
      size: b.size,
      url: b.url?.substring(0, 60) + "...",
      hasDownloadUrl: !!b.downloadUrl,
    }));

    // Try reading users.json specifically
    const usersBlobs = blobs.filter((b) => b.pathname === "users.json");
    let usersData = null;
    let readError = null;

    if (usersBlobs.length > 0) {
      const blob = usersBlobs[0];
      try {
        // Try downloadUrl first
        if (blob.downloadUrl) {
          const res = await fetch(blob.downloadUrl);
          const text = await res.text();
          usersData = { source: "downloadUrl", status: res.status, length: text.length, preview: text.substring(0, 200) };
        }
      } catch (e) {
        readError = { downloadUrl: String(e) };
      }

      if (!usersData) {
        try {
          // Try url
          const res = await fetch(blob.url);
          const text = await res.text();
          usersData = { source: "url", status: res.status, length: text.length, preview: text.substring(0, 200) };
        } catch (e) {
          readError = { ...readError, url: String(e) };
        }
      }
    }

    // Test bcrypt
    const testHash = await bcrypt.hash("iram2026", 10);
    const testMatch = await bcrypt.compare("iram2026", testHash);

    return NextResponse.json({
      blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      totalBlobs: blobs.length,
      blobs: blobInfo,
      usersBlob: usersBlobs.length > 0 ? "found" : "NOT FOUND",
      usersData,
      readError,
      bcryptWorks: testMatch,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), stack: (err as Error).stack }, { status: 500 });
  }
}
