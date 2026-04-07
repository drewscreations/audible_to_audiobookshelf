import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";
import type { LibationBook } from "./types";

/**
 * Resolve the path to LibationContext.db.
 * Checks LIBATION_CONFIG_PATH env var, then falls back to common locations.
 */
function getDbPath(): string {
  const configPath = process.env.LIBATION_CONFIG_PATH;
  if (configPath) {
    const dbPath = join(configPath, "LibationContext.db");
    if (existsSync(dbPath)) return dbPath;
  }

  // Fallback locations
  const fallbacks = [
    "/libation-config/LibationContext.db",
    join(/* turbopackIgnore: true */ process.cwd(), "libation-config", "LibationContext.db"),
  ];

  for (const p of fallbacks) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "LibationContext.db not found. Set LIBATION_CONFIG_PATH or mount the Libation config volume."
  );
}

/**
 * Query all books from Libation's SQLite database.
 * Joins Books, LibraryBooks, Contributors (authors/narrators), Series, and UserDefinedItem.
 */
export function getLibationBooks(): LibationBook[] {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const rows = db
      .prepare(
        `
      SELECT
        b.AudibleProductId AS asin,
        b.Title AS title,
        b.Subtitle AS subtitle,
        b.LengthInMinutes AS lengthInMinutes,
        b.DatePublished AS datePublished,
        b.Locale AS locale,
        b.PictureLarge AS coverUrl,
        lb.DateAdded AS dateAdded,
        lb.Account AS account,
        udi.BookStatus AS bookStatus,
        udi.LastDownloaded AS lastDownloaded,
        GROUP_CONCAT(DISTINCT CASE WHEN bc.Role = 1 THEN c.Name END) AS authors,
        GROUP_CONCAT(DISTINCT CASE WHEN bc.Role = 2 THEN c.Name END) AS narrators,
        (
          SELECT s.Name || COALESCE(' #' || sb."Order", '')
          FROM SeriesBook sb
          JOIN Series s ON s.SeriesId = sb.SeriesId
          WHERE sb.BookId = b.BookId
          LIMIT 1
        ) AS seriesInfo
      FROM Books b
      LEFT JOIN LibraryBooks lb ON lb.BookId = b.BookId
      LEFT JOIN BookContributor bc ON bc.BookId = b.BookId
      LEFT JOIN Contributors c ON c.ContributorId = bc.ContributorId
      LEFT JOIN UserDefinedItem udi ON udi.BookId = b.BookId
      WHERE b.ContentType IN (0, 1)
        AND (lb.IsDeleted IS NULL OR lb.IsDeleted = 0)
      GROUP BY b.BookId
      ORDER BY lb.DateAdded DESC
    `
      )
      .all() as Array<{
      asin: string;
      title: string;
      subtitle: string | null;
      lengthInMinutes: number | null;
      datePublished: string | null;
      locale: string | null;
      coverUrl: string | null;
      dateAdded: string | null;
      account: string | null;
      bookStatus: number | null;
      lastDownloaded: string | null;
      authors: string | null;
      narrators: string | null;
      seriesInfo: string | null;
    }>;

    return rows.map((row) => {
      // BookStatus enum: 0=NotLiberated, 1=Liberated, 2=Error, 3=PartialDownload
      const isDownloaded = row.bookStatus === 1;

      // Parse series info
      let seriesName: string | undefined;
      let seriesOrder: string | undefined;
      if (row.seriesInfo) {
        const match = row.seriesInfo.match(/^(.+?)(?:\s+#(.+))?$/);
        if (match) {
          seriesName = match[1];
          seriesOrder = match[2];
        }
      }

      return {
        asin: row.asin,
        title: row.subtitle ? `${row.title}: ${row.subtitle}` : row.title,
        authors: row.authors || "Unknown",
        narrators: row.narrators || "Unknown",
        seriesName,
        seriesOrder,
        purchaseDate: row.dateAdded || undefined,
        lengthInMinutes: row.lengthInMinutes || undefined,
        isDownloaded,
        dateAdded: row.dateAdded || undefined,
        locale: row.locale || undefined,
        coverUrl: row.coverUrl || undefined,
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Get a single book by ASIN.
 */
export function getLibationBookByAsin(asin: string): LibationBook | null {
  const books = getLibationBooks();
  return books.find((b) => b.asin === asin) || null;
}

/**
 * Get summary stats from the Libation database.
 */
export function getLibationStats(): {
  totalBooks: number;
  downloadedBooks: number;
  notDownloaded: number;
} {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const total = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM Books b
      LEFT JOIN LibraryBooks lb ON lb.BookId = b.BookId
      WHERE b.ContentType IN (0, 1)
        AND (lb.IsDeleted IS NULL OR lb.IsDeleted = 0)
    `
      )
      .get() as { count: number };

    const downloaded = db
      .prepare(
        `
      SELECT COUNT(*) as count FROM Books b
      LEFT JOIN UserDefinedItem udi ON udi.BookId = b.BookId
      LEFT JOIN LibraryBooks lb ON lb.BookId = b.BookId
      WHERE b.ContentType IN (0, 1)
        AND (lb.IsDeleted IS NULL OR lb.IsDeleted = 0)
        AND udi.BookStatus = 1
    `
      )
      .get() as { count: number };

    return {
      totalBooks: total.count,
      downloadedBooks: downloaded.count,
      notDownloaded: total.count - downloaded.count,
    };
  } finally {
    db.close();
  }
}

/**
 * Check if the Libation database is accessible.
 */
export function isLibationAvailable(): boolean {
  try {
    getDbPath();
    return true;
  } catch {
    return false;
  }
}
