import { ContentType } from "@prisma/client";
import { prisma } from "../utils/prisma";

// The four content types that can spark a DM. DIRECT_MESSAGE is intentionally excluded.
const ALLOWED_ORIGIN_TYPES: ContentType[] = [
  "POST",
  "POST_COMMENT",
  "CHAT_MESSAGE",
  "PROXIMITY_MESSAGE",
];

const ORIGIN_TEXT_MAX = 280;

export type DmOriginInput = { type: ContentType; id: number };

// Raw snapshot. The DAO finalizes anonymity masking (combining contentWasAnonymous with
// the recipient's anonymousMode) before persisting, so we never leak a hidden name.
export type DmOriginSnapshot = {
  originType: ContentType;
  originId: number;
  originText: string | null;
  originImageUrl: string | null;
  authorDisplayId: string;
  contentWasAnonymous: boolean;
  originLabel: string | null;
};

function truncate(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > ORIGIN_TEXT_MAX
    ? trimmed.slice(0, ORIGIN_TEXT_MAX - 1).trimEnd() + "…"
    : trimmed;
}

// Chat/proximity messages encode GIFs inside `content` as "[GIF]:url" or
// "[GIF]:url[MSG]:caption". Resolve that to a display-ready { text, imageUrl } so
// the client card renders an image + caption instead of a raw marker string.
function normalizeGif(
  text: string | null,
  imageUrl: string | null,
): { text: string | null; imageUrl: string | null } {
  if (!text || !text.startsWith("[GIF]:")) return { text, imageUrl };
  const msgIdx = text.indexOf("[MSG]:");
  const gifUrl = msgIdx >= 0 ? text.slice(6, msgIdx) : text.slice(6);
  const caption = msgIdx >= 0 ? text.slice(msgIdx + 6) : "";
  return { text: caption.trim() ? caption : null, imageUrl: imageUrl ?? gifUrl };
}

type NormalizedSource = {
  authorId: number;
  authorDisplayId: string;
  text: string | null;
  imageUrl: string | null;
  deleted: boolean;
  rejected: boolean;
  wasAnonymous: boolean;
  label: string | null;
};

async function loadSource(
  type: ContentType,
  id: number,
): Promise<NormalizedSource | null> {
  switch (type) {
    case "POST": {
      const p = await prisma.post.findUnique({
        where: { id },
        select: {
          posterId: true,
          title: true,
          content: true,
          imageUrl: true,
          deleted: true,
          moderationStatus: true,
          wasAnonymous: true,
          poster: { select: { displayId: true } },
        },
      });
      if (!p) return null;
      const text = p.content ? `${p.title} — ${p.content}` : p.title;
      return {
        authorId: p.posterId,
        authorDisplayId: p.poster.displayId,
        text,
        imageUrl: p.imageUrl,
        deleted: p.deleted,
        rejected: p.moderationStatus === "REJECTED",
        wasAnonymous: p.wasAnonymous,
        label: null,
      };
    }
    case "POST_COMMENT": {
      const c = await prisma.postComment.findUnique({
        where: { id },
        select: {
          commenterId: true,
          content: true,
          imageUrl: true,
          deleted: true,
          moderationStatus: true,
          wasAnonymous: true,
          commenter: { select: { displayId: true } },
        },
      });
      if (!c) return null;
      return {
        authorId: c.commenterId,
        authorDisplayId: c.commenter.displayId,
        text: c.content ?? null,
        imageUrl: c.imageUrl,
        deleted: c.deleted,
        rejected: c.moderationStatus === "REJECTED",
        wasAnonymous: c.wasAnonymous,
        label: null,
      };
    }
    case "CHAT_MESSAGE": {
      const m = await prisma.chatRoomMessage.findUnique({
        where: { id },
        select: {
          senderId: true,
          content: true,
          imageUrl: true,
          deleted: true,
          moderationStatus: true,
          wasAnonymous: true,
          sender: { select: { displayId: true } },
          chatRoom: { select: { name: true } },
        },
      });
      if (!m) return null;
      return {
        authorId: m.senderId,
        authorDisplayId: m.sender.displayId,
        text: m.content ?? null,
        imageUrl: m.imageUrl,
        deleted: m.deleted,
        rejected: m.moderationStatus === "REJECTED",
        wasAnonymous: m.wasAnonymous,
        label: m.chatRoom?.name ?? null,
      };
    }
    case "PROXIMITY_MESSAGE": {
      const m = await prisma.proximityMessage.findUnique({
        where: { id },
        select: {
          senderId: true,
          content: true,
          imageUrl: true,
          deleted: true,
          moderationStatus: true,
          sender: { select: { displayId: true } },
        },
      });
      if (!m) return null;
      return {
        authorId: m.senderId,
        authorDisplayId: m.sender.displayId,
        text: m.content ?? null,
        imageUrl: m.imageUrl,
        deleted: m.deleted,
        rejected: m.moderationStatus === "REJECTED",
        // ProximityMessage has no per-message anonymity flag; masking falls back
        // to the conversation's recipientWasAnonymous in the DAO.
        wasAnonymous: false,
        label: null,
      };
    }
    default:
      return null;
  }
}

/**
 * Builds a denormalized snapshot of the content that sparked a DM. Returns null
 * (the DM still proceeds, just without a context card) when the origin is invalid:
 * unknown type, missing/deleted/moderation-rejected content, or — crucially — when
 * the content's author is not the DM recipient. That last check prevents a client
 * from attaching arbitrary content as fake "context" and matches the semantics:
 * you DM the author about their own content.
 */
export async function buildDmOriginSnapshot(
  origin: DmOriginInput | undefined | null,
  recipientId: number,
): Promise<DmOriginSnapshot | null> {
  if (!origin || typeof origin.id !== "number") return null;
  if (!ALLOWED_ORIGIN_TYPES.includes(origin.type)) return null;

  const source = await loadSource(origin.type, origin.id);
  if (!source) return null;
  if (source.deleted || source.rejected) return null;
  if (source.authorId !== recipientId) return null;

  const normalized = normalizeGif(source.text, source.imageUrl);

  return {
    originType: origin.type,
    originId: origin.id,
    originText: truncate(normalized.text),
    originImageUrl: normalized.imageUrl ?? null,
    authorDisplayId: source.authorDisplayId,
    contentWasAnonymous: source.wasAnonymous,
    originLabel: source.label,
  };
}
