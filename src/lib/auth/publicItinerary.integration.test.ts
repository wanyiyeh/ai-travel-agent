import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import * as itineraryRoute from "@/app/api/v1/itinerary/[id]/route";
import * as stopRoute from "@/app/api/v1/stops/[stopId]/route";
import * as trashRoute from "@/app/api/v1/itinerary/[id]/trash/route";

// Story: the admin publishes one of their itineraries as a portfolio example.
// Anyone with the link can read it — signed in or not — but it stays
// read-only: no writes, no trash, and the owner's private style blurb isn't
// shown. Unpublishing makes it private again. plan/access-control.md §8.

const stamp = Date.now();
const admin = { id: `pub-admin-${stamp}`, email: `pub-admin-${stamp}@example.com` };
const stranger = { id: `pub-stranger-${stamp}`, email: `pub-stranger-${stamp}@example.com` };
const plainOwner = { id: `pub-owner-${stamp}`, email: `pub-owner-${stamp}@example.com` };
const exampleId = `pub-example-${stamp}`;
const privateId = `pub-private-${stamp}`;
const stopId = `pub-stop-${stamp}`;

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => itineraryRoute.GET(new Request("http://test"), p(id));
const patch = (id: string, body: unknown) =>
  itineraryRoute.PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), p(id));

beforeAll(async () => {
  process.env.ADMIN_EMAILS = admin.email;
  await prisma.user.createMany({ data: [admin, stranger, plainOwner] });
  await prisma.itinerary.create({
    data: {
      id: exampleId,
      userId: admin.id,
      title: "Example trip",
      isPublic: true,
      config: j({ generatedWith: "私人的風格描述", currency: "KRW" }),
      days: j([{ id: `pub-day-${stamp}`, day: 1, stops: [{ id: stopId, name: "景點" }] }]),
    },
  });
  await prisma.itinerary.create({
    data: { id: privateId, userId: plainOwner.id, title: "Private", config: j({}), days: j([]) },
  });
});

afterAll(async () => {
  delete process.env.ADMIN_EMAILS;
  await prisma.itinerary.deleteMany({ where: { id: { in: [exampleId, privateId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, stranger.id, plainOwner.id] } } });
});

describe("a published example", () => {
  it("can be read signed out, as read-only, without the owner's style blurb", async () => {
    signInAs(null);
    const res = await get(exampleId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access).toBe("public");
    expect(body.canPublish).toBe(false);
    expect(body.config.generatedWith).toBeUndefined();
    expect(body.config.currency).toBe("KRW");
  });

  it("can be read by another signed-in user, still read-only", async () => {
    signInAs(stranger);
    const body = await (await get(exampleId)).json();
    expect(body.access).toBe("public");
  });

  it("refuses every write and the trash to non-owners", async () => {
    signInAs(stranger);
    const edit = await stopRoute.PATCH(
      new Request("http://test", { method: "PATCH", body: JSON.stringify({ itineraryId: exampleId, name: "改掉" }) }),
      { params: Promise.resolve({ stopId }) },
    );
    expect(edit.status).toBe(404);
    expect((await itineraryRoute.DELETE(new Request("http://test"), p(exampleId))).status).toBe(404);
    expect((await trashRoute.GET(new Request("http://test"), p(exampleId))).status).toBe(404);
    expect((await patch(exampleId, { isPublic: false })).status).toBe(404);

    signInAs(null);
    expect((await itineraryRoute.DELETE(new Request("http://test"), p(exampleId))).status).toBe(401);

    const row = await prisma.itinerary.findUnique({ where: { id: exampleId } });
    expect((row?.days as { stops: { name: string }[] }[])[0].stops[0].name).toBe("景點");
    expect(row?.isPublic).toBe(true);
  });

  it("gives the owner full access, including the style blurb and the publish control", async () => {
    signInAs(admin);
    const body = await (await get(exampleId)).json();
    expect(body.access).toBe("owner");
    expect(body.canPublish).toBe(true);
    expect(body.config.generatedWith).toBe("私人的風格描述");
  });
});

describe("publishing", () => {
  it("is admin-only: a regular owner can't publish their own itinerary", async () => {
    signInAs(plainOwner);
    const res = await patch(privateId, { isPublic: true });
    expect(res.status).toBe(403);
    expect((await prisma.itinerary.findUnique({ where: { id: privateId } }))?.isPublic).toBe(false);
    expect((await (await get(privateId)).json()).canPublish).toBe(false);
  });

  it("a private itinerary stays hidden from others (404 signed in, 401 signed out)", async () => {
    signInAs(stranger);
    expect((await get(privateId)).status).toBe(404);
    signInAs(null);
    expect((await get(privateId)).status).toBe(401);
  });

  it("unpublishing makes the example private again", async () => {
    signInAs(admin);
    const res = await patch(exampleId, { isPublic: false });
    expect(res.status).toBe(200);
    expect((await res.json()).isPublic).toBe(false);

    signInAs(null);
    expect((await get(exampleId)).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    signInAs(admin);
    expect((await patch(exampleId, { isPublic: "yes" })).status).toBe(400);
  });
});
