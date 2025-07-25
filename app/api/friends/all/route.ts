import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const currentUserId = new ObjectId(session.user.id);

    const pendingRequests = await db
      .collection("friendships")
      .aggregate([
        { $match: { recipient: currentUserId, status: "pending" } },
        {
          $lookup: {
            from: "users",
            localField: "requester",
            foreignField: "_id",
            as: "requesterDetails",
          },
        },
        { $unwind: "$requesterDetails" },
        {
          $project: {
            _id: 1,
            requester: {
              _id: "$requesterDetails._id",
              name: "$requesterDetails.name",
              email: "$requesterDetails.email",
              profilePhoto: "$requesterDetails.profilePhoto",
            },
            createdAt: 1,
          },
        },
      ])
      .toArray();

    const friends = await db
      .collection("friendships")
      .aggregate([
        {
          $match: {
            status: "accepted",
            $or: [{ requester: currentUserId }, { recipient: currentUserId }],
          },
        },
        {
          $project: {
            friendId: {
              $cond: {
                if: { $eq: ["$requester", currentUserId] },
                then: "$recipient",
                else: "$requester",
              },
            },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "friendId",
            foreignField: "_id",
            as: "friendDetails",
          },
        },
        { $unwind: "$friendDetails" },
        {
          $project: {
            friendshipId: "$_id",
            friend: {
              _id: "$friendDetails._id",
              name: "$friendDetails.name",
              email: "$friendDetails.email",
              profilePhoto: "$friendDetails.profilePhoto",
            },
          },
        },
      ])
      .toArray();

    return NextResponse.json({ pendingRequests, friends });
  } catch (error) {
    console.error("Error fetching friends data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
