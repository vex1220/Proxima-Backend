import jwt from "jsonwebtoken";
import { Resend } from "resend";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setUserVerified,
  updateUserPassword,
  userExists,
} from "../services/userService";
import { User } from "@prisma/client";
import { UserWithPreferences } from "../models/userTypes";
import redis from "../utils/setupRedis";
import { clearSession } from "../utils/redisSession";

const resend = new Resend(process.env.EMAIL_API_KEY!);
const OTPValidTime = Number(process.env.OTP_TIL_SEC) || 300;
const OTPMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS) || 10;
const OTPRateLimit = Number(process.env.OTP_RATE_LIMIT) || 300;
const ResetTokenTTLSec = 600;

export async function registerUser(
  email: string,
  displayId: string,
  password: string,
) {
  if (await userExists(email, displayId)) {
    throw new Error("User already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  return await createUser(email, displayId, hashedPassword);
}

export async function loginUser(email: string, password: string) {
  const user = await getUserByEmail(email);

  if (!user || user.deleted) {
    throw new Error("incorrect credentials");
  }

  const passwordCorrect = await bcrypt.compare(password, user.password);
  if (!passwordCorrect) {
    throw new Error("incorrect credentials");
  }

  const accessToken = await genAccessTokenFromUser(user);
  const refreshToken = await genRefreshTokenFromUser(user);

  return { email: user.email, accessToken, refreshToken };
}

export async function refreshAccessToken(refreshToken: string) {
  try {
    const user = await userFromRefreshToken(refreshToken);

    if (!user || user.deleted) {
      throw new Error("user does not exist");
    }

    if(!user.isVerified){
      throw new Error("users email is not verified");
    }

    const newAccessToken = await genAccessTokenFromUser(user);

    return await { accessToken: newAccessToken };
  } catch (err) {
    throw new Error("invalid refresh token");
  }
}

export async function genAccessTokenFromUser(user: User) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET as string,
    { expiresIn: "15m" },
  );
}

export async function genRefreshTokenFromUser(user: User) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: "30d" },
  );
}

export async function userFromAccessToken(
  token: string,
): Promise<UserWithPreferences> {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as {
      userId: number;
      email: string;
      purpose?: string;
    };

    if (payload.purpose) {
      throw new Error("invalid token");
    }

    const user = await getUserById(payload.userId);

    if (!user) {
      throw new Error("user does not exist");
    }

    return user;
  } catch (error) {
    throw new Error("invalid token");
  }
}

export async function userFromRefreshToken(token: string) {
  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET as string,
    ) as { userId: number; email: string };

    const user = await getUserById(payload.userId);

    if (!user) {
      throw new Error("user does not exist");
    }

    return user;
  } catch (error) {
    throw new Error("invalid token");
  }
}

export async function sendOneTimeCode(email: string) {
  const sendCountKey = `otp:sendcount:${email}`;
  const otpKey = `otp:${email}`;

  const sends = Number((await redis.get(sendCountKey)) || 0);
  if (sends >= OTPRateLimit) {
    throw new Error("Too many OTP requests, try later");
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");

  await redis.setex(otpKey, OTPValidTime, code);
  await redis.incr(sendCountKey);
  await redis.expire(sendCountKey, 3600);

  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Your verification code",
    html: `<p>Your verification code: <strong>${code}</strong></p><p>It expires in ${Math.ceil(
      OTPValidTime / 60,
    )} minutes.</p>`,
  });
  return { message: "OTP sent" };
}

export async function verifyOneTimeCode(email: string, code: string) {
  const otpKey = `otp:${email}`;
  const attemptsKey = `otp:attempts:${email}`;

  const stored = await redis.get(otpKey);
  if (!stored) throw new Error("Invalid or expired code");

  const attempts = Number((await redis.incr(attemptsKey)) || 0);
  await redis.expire(attemptsKey, OTPValidTime);

  if (attempts > OTPMaxAttempts) {
    await redis.del(otpKey);
    await redis.del(attemptsKey);
    throw new Error("Too many attempts");
  }

  if (stored !== code) {
    throw new Error("Invalid code");
  }

  await redis.del(otpKey);
  await redis.del(attemptsKey);

  const user = await getUserByEmail(email);
  if (!user) {
    throw new Error("invalid user");
  }
  await setUserVerified(user.id);

  const accessToken = await genAccessTokenFromUser(user);
  const refreshToken = await genRefreshTokenFromUser(user);

  return { user, accessToken, refreshToken };
}

// ─── Password reset ──────────────────────────────────────────────────────────
// Uses a Redis namespace (`pwreset:*`) separate from the email-verification
// OTPs so the two flows can't collide. After OTP verification we issue a
// short-lived JWT with `purpose: "pwreset"` plus a Redis-stored jti, redeemed
// once by `resetPassword`.

export async function sendPasswordResetCode(email: string) {
  const sendCountKey = `pwreset:sendcount:${email}`;
  const codeKey = `pwreset:${email}`;

  const user = await getUserByEmail(email);
  // Silent no-op when the user doesn't exist (prevents account enumeration).
  if (!user || user.deleted) {
    return { message: "If an account exists, a reset code has been sent" };
  }

  const sends = Number((await redis.get(sendCountKey)) || 0);
  if (sends >= OTPRateLimit) {
    throw new Error("Too many reset requests, try later");
  }

  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");

  await redis.setex(codeKey, OTPValidTime, code);
  await redis.incr(sendCountKey);
  await redis.expire(sendCountKey, 3600);

  await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: email,
    subject: "Reset your Proxima password",
    html: `<p>Your password reset code: <strong>${code}</strong></p><p>It expires in ${Math.ceil(
      OTPValidTime / 60,
    )} minutes. If you didn't request this, you can ignore the email.</p>`,
  });

  return { message: "If an account exists, a reset code has been sent" };
}

export async function verifyPasswordResetCode(email: string, code: string) {
  const codeKey = `pwreset:${email}`;
  const attemptsKey = `pwreset:attempts:${email}`;

  const stored = await redis.get(codeKey);
  if (!stored) throw new Error("Invalid or expired code");

  const attempts = Number((await redis.incr(attemptsKey)) || 0);
  await redis.expire(attemptsKey, OTPValidTime);

  if (attempts > OTPMaxAttempts) {
    await redis.del(codeKey);
    await redis.del(attemptsKey);
    throw new Error("Too many attempts");
  }

  if (stored !== code) {
    throw new Error("Invalid code");
  }

  const user = await getUserByEmail(email);
  if (!user || user.deleted) {
    throw new Error("invalid user");
  }

  await redis.del(codeKey);
  await redis.del(attemptsKey);

  const jti = crypto.randomBytes(16).toString("hex");
  await redis.setex(`pwreset:jti:${jti}`, ResetTokenTTLSec, String(user.id));

  const resetToken = jwt.sign(
    { userId: user.id, email: user.email, purpose: "pwreset", jti },
    process.env.JWT_SECRET as string,
    { expiresIn: ResetTokenTTLSec },
  );

  return { resetToken };
}

export async function resetPassword(resetToken: string, newPassword: string) {
  let payload: { userId: number; email: string; purpose?: string; jti?: string };
  try {
    payload = jwt.verify(
      resetToken,
      process.env.JWT_SECRET as string,
    ) as typeof payload;
  } catch {
    throw new Error("invalid or expired reset token");
  }

  if (payload.purpose !== "pwreset" || !payload.jti) {
    throw new Error("invalid reset token");
  }

  const jtiKey = `pwreset:jti:${payload.jti}`;
  const storedUserId = await redis.get(jtiKey);
  if (!storedUserId || Number(storedUserId) !== payload.userId) {
    throw new Error("invalid or expired reset token");
  }

  const user = await getUserById(payload.userId);
  if (!user || user.deleted) {
    throw new Error("user does not exist");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await updateUserPassword(user.id, hashedPassword);

  await redis.del(jtiKey);
  await clearSession(user.id);

  return { message: "Password has been reset" };
}
