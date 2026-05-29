import { Resend } from "resend";
import crypto from "crypto";
import { prisma } from "../utils/prisma";
import redis from "../utils/setupRedis";
import {
  setUserVerifiedCampusDao,
  getUserByVerifiedEmailDao,
} from "../dao/userServiceDao";

// ─── Campus (school) email verification ───────────────────────────────────────
// Lets a user who signed up with a personal email prove ownership of a school
// `.edu` address and link their account to a campus, unlocking campus-only
// features (Greek Touse/Bouse voting anywhere on campus + campus themes).
//
// Mirrors the OTP flow in authService.ts but lives in its own `campusverify:*`
// Redis namespace and writes `verifiedCampusId`/`verifiedEmail` — it does NOT
// touch the account-level `isVerified` flag.

const resend = new Resend(process.env.EMAIL_API_KEY!);
const OTPValidTime = Number(process.env.OTP_TIL_SEC) || 300;
const OTPMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 10;
const OTPRateLimit = Number(process.env.OTP_RATE_LIMIT) || 300;

export type ResolvedCampus = { id: number; name: string; themeBrand: string | null };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1) || null;
}

function codeKeyFor(userId: number) {
  return `campusverify:code:${userId}`;
}
function attemptsKeyFor(userId: number) {
  return `campusverify:attempts:${userId}`;
}
function sendCountKeyFor(userId: number) {
  return `campusverify:sendcount:${userId}`;
}

/**
 * Resolve the campus an email domain belongs to via the CampusEmailDomain table.
 * Returns null when the domain isn't onboarded (or the campus was soft-deleted).
 * This is the single multi-university mapping point — onboarding a new school is
 * just inserting a CampusEmailDomain row + a campus Location.
 */
export async function resolveCampusForEmail(
  email: string,
): Promise<ResolvedCampus | null> {
  const domain = domainOf(normalizeEmail(email));
  if (!domain) return null;

  const match = await prisma.campusEmailDomain.findFirst({
    where: { domain: { equals: domain, mode: "insensitive" } },
    select: {
      campus: {
        select: { id: true, name: true, themeBrand: true, deleted: true },
      },
    },
  });

  if (!match?.campus || match.campus.deleted) return null;
  return {
    id: match.campus.id,
    name: match.campus.name,
    themeBrand: match.campus.themeBrand,
  };
}

/**
 * Send a 6-digit verification code to a school email. Rejects non-`.edu` and
 * not-yet-onboarded universities, and refuses an email already verified on
 * another account.
 */
export async function sendCampusVerificationCode(
  userId: number,
  rawEmail: string,
) {
  const schoolEmail = normalizeEmail(rawEmail);

  if (!schoolEmail.endsWith(".edu")) {
    throw new Error("Enter a valid school (.edu) email");
  }

  const campus = await resolveCampusForEmail(schoolEmail);
  if (!campus) {
    throw new Error("Proxima doesn't support your university yet");
  }

  // One school email per account (vote integrity).
  const existing = await getUserByVerifiedEmailDao(schoolEmail);
  if (existing && existing.id !== userId) {
    throw new Error("That school email is already verified on another account");
  }

  const sendCountKey = sendCountKeyFor(userId);
  const sends = Number((await redis.get(sendCountKey)) || 0);
  if (sends >= OTPRateLimit) {
    throw new Error("Too many requests, try later");
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");

  // Bind the code to the exact email so a user can't get a code for school A
  // and confirm it against school B.
  await redis.setex(
    codeKeyFor(userId),
    OTPValidTime,
    JSON.stringify({ email: schoolEmail, code }),
  );
  await redis.del(attemptsKeyFor(userId));
  await redis.incr(sendCountKey);
  await redis.expire(sendCountKey, 3600);

  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: schoolEmail,
    subject: `Verify your ${campus.name} email`,
    html: `<p>Your ${campus.name} verification code: <strong>${code}</strong></p><p>It expires in ${Math.ceil(
      OTPValidTime / 60,
    )} minutes.</p>`,
  });

  return { message: "Verification code sent", campusName: campus.name };
}

/**
 * Confirm the code and link the user to the campus. Re-resolves the campus and
 * re-checks uniqueness server-side (don't trust client state between send/confirm).
 */
export async function confirmCampusVerification(userId: number, code: string) {
  const codeKey = codeKeyFor(userId);
  const attemptsKey = attemptsKeyFor(userId);

  const stored = await redis.get(codeKey);
  if (!stored) throw new Error("Invalid or expired code");

  const attempts = Number((await redis.incr(attemptsKey)) || 0);
  await redis.expire(attemptsKey, OTPValidTime);

  if (attempts > OTPMaxAttempts) {
    await redis.del(codeKey);
    await redis.del(attemptsKey);
    throw new Error("Too many attempts");
  }

  let parsed: { email: string; code: string };
  try {
    parsed = JSON.parse(stored);
  } catch {
    await redis.del(codeKey);
    throw new Error("Invalid or expired code");
  }

  if (parsed.code !== code) {
    throw new Error("Invalid code");
  }

  const campus = await resolveCampusForEmail(parsed.email);
  if (!campus) {
    await redis.del(codeKey);
    await redis.del(attemptsKey);
    throw new Error("Proxima doesn't support your university yet");
  }

  const existing = await getUserByVerifiedEmailDao(parsed.email);
  if (existing && existing.id !== userId) {
    await redis.del(codeKey);
    await redis.del(attemptsKey);
    throw new Error("That school email is already verified on another account");
  }

  await setUserVerifiedCampusDao(userId, campus.id, parsed.email);

  await redis.del(codeKey);
  await redis.del(attemptsKey);

  return {
    campusId: campus.id,
    campusName: campus.name,
    themeBrand: campus.themeBrand,
  };
}
