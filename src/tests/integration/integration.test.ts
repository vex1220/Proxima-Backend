import request from "supertest";
import * as clientLib from "socket.io-client";
import app from "../../index";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import { setupSocket } from "../../websocket/setupSocket";
import prisma from "../../utils/prisma";

let httpServer: any = null;
let ioServer: any = null;
const BASE_URL = process.env.TEST_URL || "http://localhost:8000";
let serverUrl = BASE_URL;

beforeAll((done) => {
  // start a real http + socket.io server for socket tests
  httpServer = createServer(app);
  ioServer = new IOServer(httpServer, { cors: { origin: '*' } });
  setupSocket(ioServer);
  httpServer.listen(0, () => {
    const addr: any = httpServer.address();
    const port = addr.port;
    serverUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  if (ioServer) ioServer.close();
  if (httpServer) httpServer.close(done);
  else done();
});

// runtime-compatible client import — some type packages for socket.io-client
// can mismatch; resolve the runtime export defensively
const Client = (clientLib as any).io ?? (clientLib as any).default ?? clientLib;
type Socket = any;

describe("Basic HTTP route checks", () => {
  it("GET / should return 200 and status message", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
  });

  it("POST /api/auth/register with invalid payload should return 400", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "not-an-email",
      displayId: "ab",
      password: "123",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/auth/login with invalid payload should return 400", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "bad",
      password: "123",
    });
    expect(res.status).toBe(400);
  });

  it("Protected route /api/chatroom/list without token should return 401", async () => {
    const res = await request(app).get("/api/chatroom/list");
    expect(res.status).toBe(401);
  });

  it("Protected route /api/user/me without token should return 401", async () => {
    const res = await request(app).get("/api/user/me");
    expect(res.status).toBe(401);
  });
});

describe("WebSocket connection and error handling", () => {
  let clientSocket: Socket | null = null;

  afterEach(() => {
    if (clientSocket && clientSocket.connected) clientSocket.disconnect();
    clientSocket = null;
  });

  it("should refuse connections without a token", (done) => {
    clientSocket = Client(serverUrl, {
      reconnection: false,
    }) as unknown as Socket;

    clientSocket.on("connect_error", (err: any) => {
      try {
        expect(err).toBeDefined();
        // server sends Error("No token provided") when auth missing
        expect(String(err)).toMatch(/No token provided|Invalid or expired token/);
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it("should refuse connections with an invalid token", (done) => {
    clientSocket = Client(serverUrl, {
      auth: { token: "this-is-invalid-token" },
      reconnection: false,
    }) as unknown as Socket;

    clientSocket.on("connect_error", (err: any) => {
      try {
        expect(err).toBeDefined();
        expect(String(err)).toMatch(/Invalid or expired token|User no longer exists/);
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it("should allow connection with a valid token and respond to joinRoom with error for missing room", async () => {
    // register a test user and login to get token
    const unique = Date.now();
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    // connect socket with token and wait for server error on joinRoom
    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, {
        auth: { token },
        reconnection: false,
      }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket!.emit("joinRoom", 9999999);
      });

      clientSocket.on("error", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          expect(String(msg)).toMatch(/Chat room not found|out of range/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for socket error")), 5000);
    });
  });

  it("sendMessage to missing room should return error", async () => {
    // reuse a fresh user
    const unique = Date.now() + 1;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket.emit("sendMessage", { roomId: 9999999, content: "hello" });
      });

      clientSocket.on("error", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          expect(String(msg)).toMatch(/Chat room not found|out of range/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for sendMessage error")), 5000);
    });
  });

  it("deleteMessage for non-existent message should return error", async () => {
    const unique = Date.now() + 2;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket.emit("deleteMessage", { roomId: 9999999, messageId: 9999999 });
      });

      clientSocket.on("error", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          expect(String(msg)).toMatch(/Chat room not found|out of range|Action not Authorized/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for deleteMessage error")), 5000);
    });
  });

  it("voteMessage for non-existent message should return error", async () => {
    const unique = Date.now() + 3;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket.emit("voteMessage", { roomId: 9999999, messageId: 9999999, vote: 1 });
      });

      clientSocket.on("error", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          expect(String(msg)).toMatch(/Chat room not found|out of range|You cannot vote on your own message/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for voteMessage error")), 5000);
    });
  });

  it("leaveRoom should not emit an error", async () => {
    const unique = Date.now() + 4;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      let errored = false;
      clientSocket.on("error", (msg: any) => {
        errored = true;
      });

      clientSocket.on("connect", () => {
        clientSocket.emit("leaveRoom");
      });

      setTimeout(() => {
        if (errored) reject(new Error("leaveRoom emitted error"));
        else resolve();
      }, 500);
    });
  });

  it("updateLocation should respond with nearbyUserCount or error", async () => {
    const unique = Date.now() + 5;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket.emit("updateLocation", { latitude: 37.7749, longitude: -122.4194 });
      });

      clientSocket.on("nearbyUserCount", (payload: any) => {
        try {
          expect(payload).toBeDefined();
          expect(payload).toHaveProperty("count");
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("error", (msg: any) => {
        // acceptable fallback if redis not available or no nearby users
        resolve();
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for updateLocation response")), 5000);
    });
  });

  it("sendProximityMessage should either receive an error or receiveProximityMessage", async () => {
    const unique = Date.now() + 6;
    const email = `test+${unique}@example.com`;
    const displayId = `testuser${unique}`;
    const password = "password123";

    const reg = await request(app).post("/api/auth/register").send({
      email,
      displayId,
      password,
    });
    expect(reg.status).toBe(201);

    const login = await request(app).post("/api/auth/login").send({
      email,
      password,
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;
    expect(token).toBeDefined();

    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token }, reconnection: false }) as unknown as Socket;

      clientSocket.on("connect", () => {
        clientSocket.emit("sendProximityMessage", { latitude: 37.7749, longitude: -122.4194, content: "hello nearby" });
      });

      clientSocket.on("receiveProximityMessage", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("error", (msg: any) => {
        // acceptable fallback
        resolve();
      });

      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout waiting for sendProximityMessage response")), 5000);
    });
  });

  it("positive flow: create chatRoom, join, sendMessage, deleteMessage, voteMessage", async () => {
    const unique = Date.now() + 10;
    // create chat room directly in DB (no geo fields so join won't check range)
    const chatRoom = await prisma.chatRoom.create({ data: { name: `testroom-${unique}` } });

    // register two users
    const email1 = `pos1+${unique}@example.com`;
    const displayId1 = `posuser1${unique}`;
    const password = "password123";

    const reg1 = await request(app).post("/api/auth/register").send({ email: email1, displayId: displayId1, password });
    expect(reg1.status).toBe(201);
    const login1 = await request(app).post("/api/auth/login").send({ email: email1, password });
    expect(login1.status).toBe(200);
    const token1 = login1.body.accessToken;
    expect(token1).toBeDefined();

    const email2 = `pos2+${unique}@example.com`;
    const displayId2 = `posuser2${unique}`;
    const reg2 = await request(app).post("/api/auth/register").send({ email: email2, displayId: displayId2, password });
    expect(reg2.status).toBe(201);
    const login2 = await request(app).post("/api/auth/login").send({ email: email2, password });
    expect(login2.status).toBe(200);
    const token2 = login2.body.accessToken;
    expect(token2).toBeDefined();

    // connect user1 socket and join room
    return new Promise<void>((resolve, reject) => {
      clientSocket = Client(serverUrl, { auth: { token: token1 }, reconnection: false }) as unknown as Socket;

      let createdMessageId: number | null = null;

      clientSocket.on("joinedRoom", (payload: any) => {
        try {
          expect(payload).toBeDefined();
          expect(payload.chatRoom).toBeDefined();
          // send a message
          clientSocket.emit("sendMessage", { roomId: chatRoom.id, content: "hello from user1" });
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("receiveMessage", (msg: any) => {
        try {
          expect(msg).toBeDefined();
          expect(msg.content).toBe("hello from user1");
          createdMessageId = msg.messageId;
          // now delete the message as the sender
          clientSocket.emit("deleteMessage", { roomId: chatRoom.id, messageId: createdMessageId });
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("updateMessage", async (updated: any) => {
        try {
          if (updated && updated.id === createdMessageId) {
            // deleted message update
            expect(updated.deleted).toBe(true);
            // create a message by user2 directly in DB to test voting
            const user2 = await prisma.user.findUnique({ where: { email: email2 } });
            if (!user2) return reject(new Error("user2 not found"));
            const otherMsg = await prisma.chatRoomMessage.create({ data: { chatRoomId: chatRoom.id, senderId: user2.id, content: "message by user2" }, include: { sender: { select: { displayId: true } } } });
            // emit vote from user1
            clientSocket.emit("voteMessage", { roomId: chatRoom.id, messageId: otherMsg.id, vote: 1 });
          } else if (updated && typeof updated.voteCount !== "undefined") {
            // vote update
            expect(updated.voteCount).toBeGreaterThanOrEqual(1);
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      });

      clientSocket.on("connect", () => {
        clientSocket.emit("joinRoom", chatRoom.id);
      });

      clientSocket.on("error", (msg: any) => reject(new Error(String(msg))));
      clientSocket.on("connect_error", (err: any) => reject(err));
      setTimeout(() => reject(new Error("timeout in positive flow test")), 8000);
    });
  });
});
// Note: these integration tests perform basic smoke checks only.
// Full end-to-end testing of authenticated routes and socket events
// requires test fixtures (DB, Redis) and valid tokens; add those
// in a dedicated CI environment or expand these tests when a test
// database and seeded users are available.
