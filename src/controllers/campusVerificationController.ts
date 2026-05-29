import { Request, Response } from "express";
import {
  sendCampusVerificationCode,
  confirmCampusVerification,
} from "../services/campusVerificationService";

function errorStatus(message: string): number {
  if (/too many/i.test(message)) return 429;
  if (/already verified on another/i.test(message)) return 409;
  return 400;
}

export async function sendSchoolCode(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { schoolEmail } = req.body;
    const response = await sendCampusVerificationCode(user.id, schoolEmail);
    return res.status(200).json(response);
  } catch (error: any) {
    return res.status(errorStatus(error.message)).json({ message: error.message });
  }
}

export async function confirmSchoolCode(req: Request, res: Response) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { code } = req.body;
    const result = await confirmCampusVerification(user.id, code);
    return res.status(200).json({ message: "School email verified", ...result });
  } catch (error: any) {
    return res.status(errorStatus(error.message)).json({ message: error.message });
  }
}
