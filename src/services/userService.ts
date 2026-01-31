import { User } from "@prisma/client";
import {
  createUserDao,
  deleteUserDao,
  getUserByDisplayIdDao,
  getUserByEmailDao,
  getUserByIdDao,
} from "../dao/userServiceDao";
import prisma from "../utils/prisma";
import { deleteMessagesByUser } from "./messageService";

export async function createUser(
  email: string,
  displayId: string,
  password: string,
) {
  return await createUserDao(email, displayId, password);
}

export async function deleteUser(user: User) {
  return await deleteUserDao(user.id);
}

export async function userExists(
  email: string,
  displayId: string,
): Promise<boolean> {
  return !!(await getUserByEmail(email)) || (await userNameInUse(displayId));
}

export async function getUserByEmail(email: string) {
  return await getUserByEmailDao(email);
}

export async function getUserById(id: number) {
  return await getUserByIdDao(id);
}

export async function getUserByDisplayId(name: string) {
  return await getUserByDisplayIdDao(name);
}

export async function userNameInUse(name: string): Promise<boolean> {
  const user = await getUserByDisplayId(name);
  return !!user && !user.deleted;
}
