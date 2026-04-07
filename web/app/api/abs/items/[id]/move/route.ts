import { NextResponse } from "next/server";
import { createABSClient } from "@/lib/abs-client";
import { rename, existsSync } from "fs";
import { join, basename } from "path";
import { promisify } from "util";

const renameAsync = promisify(rename);

/**
 * Library folder mapping: ABS library folder path → local mount path.
 *
 * ABS sees: /audiobooks/Audiobooks and /audiobooks/Mo Books
 * Docker mount: /share/JellyWhale/Audiobooks → /audiobooks (in web container)
 *
 * So /audiobooks/Audiobooks in ABS = /audiobooks/Audiobooks in our container.
 */
const AUDIOBOOKS_ROOT = "/audiobooks";

/**
 * POST /api/abs/items/[id]/move
 * Body: { targetLibraryId: string }
 *
 * Moves an audiobook folder from its current library directory to the target
 * library directory, then triggers ABS scans on both libraries.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itemId } = await params;
    const body = await request.json();
    const targetLibraryId: string = body.targetLibraryId;

    if (!targetLibraryId) {
      return NextResponse.json(
        { ok: false, error: "targetLibraryId is required" },
        { status: 400 }
      );
    }

    // Use root token for admin operations (scan requires admin)
    const client = createABSClient("root");

    // Get item details to find its folder
    const item = await client.getItem(itemId);
    const sourceLibraryId = item.libraryId;

    if (sourceLibraryId === targetLibraryId) {
      return NextResponse.json(
        { ok: false, error: "Item is already in the target library" },
        { status: 400 }
      );
    }

    // Get both libraries to find their folder paths
    const libraries = await client.libraries();
    const sourceLib = libraries.find((l) => l.id === sourceLibraryId);
    const targetLib = libraries.find((l) => l.id === targetLibraryId);

    if (!sourceLib || !targetLib) {
      return NextResponse.json(
        { ok: false, error: "Source or target library not found" },
        { status: 404 }
      );
    }

    // Get the folder paths (ABS paths like /audiobooks/Audiobooks)
    const sourceFolderPath = sourceLib.folders[0]?.fullPath;
    const targetFolderPath = targetLib.folders[0]?.fullPath;

    if (!sourceFolderPath || !targetFolderPath) {
      return NextResponse.json(
        { ok: false, error: "Library folder paths not found" },
        { status: 500 }
      );
    }

    // Map ABS paths to local container paths
    // ABS sees /audiobooks/X, our container has /audiobooks/X at the same path
    const sourceDir = join(AUDIOBOOKS_ROOT, basename(sourceFolderPath));
    const targetDir = join(AUDIOBOOKS_ROOT, basename(targetFolderPath));

    // Find the item's folder name by looking at its path
    // ABS item path is typically like /audiobooks/Audiobooks/Mage Tank [B0DVTP6FL7]
    // We need just the folder name
    const itemPath = (item as unknown as { path: string }).path || "";
    const folderName = basename(itemPath);

    if (!folderName) {
      return NextResponse.json(
        { ok: false, error: "Could not determine item folder name" },
        { status: 500 }
      );
    }

    const sourcePath = join(sourceDir, folderName);
    const destPath = join(targetDir, folderName);

    // Verify source exists
    if (!existsSync(sourcePath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Source folder not found: ${folderName}`,
        },
        { status: 404 }
      );
    }

    // Verify destination doesn't already exist
    if (existsSync(destPath)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Folder already exists in target library: ${folderName}`,
        },
        { status: 409 }
      );
    }

    // Move the folder
    await renameAsync(sourcePath, destPath);

    // Trigger ABS library scans on both libraries
    await Promise.allSettled([
      client.scanLibrary(sourceLibraryId),
      client.scanLibrary(targetLibraryId),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        itemId,
        folderName,
        from: sourceLib.name,
        to: targetLib.name,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
