"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Send, Check, X, Users, Mail } from "lucide-react";
import toast from "react-hot-toast";
import Navbar from "@/components/Layout/Navbar";
import Footer from "@/components/Layout/Footer";
import { User, Message } from "@/types"; // Make sure your types file has User and Message interfaces
import { io, Socket } from "socket.io-client";

// Define clear types for the data handled by this page
interface PendingRequest {
  _id: string; // The friendshipId
  requester: User;
}

interface FriendData {
  friendshipId: string;
  friend: User;
}

// --- ChatBox Component ---
const ChatBox = ({
  friendData,
  currentUser,
}: {
  friendData: FriendData;
  currentUser: User;
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const chatEndRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    // Fetch historical messages for this chat when the component loads
    const fetchHistory = async () => {
      const res = await fetch(`/api/chat/${friendData.friendshipId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    };
    fetchHistory();

    // Establish a new WebSocket connection
    const newSocket = io("http://localhost:3001");
    setSocket(newSocket);

    // Join a room specific to this chat using the unique friendshipId
    newSocket.emit("join_chat_room", friendData.friendshipId);

    // Listen for new incoming messages for this room
    newSocket.on("receive_message", (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    // Disconnect the socket when the component unmounts or the friend changes
    return () => newSocket.disconnect();
  }, [friendData.friendshipId]); // Rerun effect if the selected friend changes

  // Auto-scroll to the latest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Updated function to call the API route that saves messages
  const handleSendMessage = async () => {
    if (newMessage.trim() === "") return;

    const messageContent = newMessage;
    setNewMessage(""); // Optimistically clear the input

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: friendData.friendshipId,
          content: messageContent,
        }),
      });

      // The message will be displayed via the socket listener for everyone.
      // This ensures only saved messages are shown.
      if (!response.ok) {
        toast.error("Failed to send message.");
        setNewMessage(messageContent); // Restore the message on failure
      }
    } catch (error) {
      toast.error("Failed to send message.");
      setNewMessage(messageContent);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 border-b flex items-center gap-3">
        <Avatar>
          <AvatarImage src={friendData.friend.profilePhoto} />
          <AvatarFallback>{friendData.friend.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <h3 className="font-bold text-lg">{friendData.friend.name}</h3>
      </div>
      <div className="flex-grow p-4 overflow-y-auto bg-gray-50">
        {messages.map((msg) => (
          <div
            key={msg._id.toString()}
            className={`flex items-end gap-2 ${
              msg.senderId.toString() === currentUser.id
                ? "justify-end"
                : "justify-start"
            } mb-4`}
          >
            <div
              className={`max-w-xs md:max-w-md p-3 rounded-lg ${
                msg.senderId.toString() === currentUser.id
                  ? "bg-purple-600 text-white rounded-br-none"
                  : "bg-gray-200 text-black rounded-bl-none"
              }`}
            >
              <p>{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div className="p-4 border-t flex gap-2 bg-white">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
          className="h-10"
        />
        <Button onClick={handleSendMessage} className="h-10">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

// --- Main Friends Page Component ---
export default function FriendsPage() {
  const { data: session, status } = useSession();
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [friends, setFriends] = useState<FriendData[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<FriendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    try {
      const response = await fetch("/api/friends/all");
      if (response.ok) {
        const { pendingRequests, friends } = await response.json();
        setPendingRequests(pendingRequests);
        setFriends(friends);
      } else {
        toast.error("Failed to load friend data.");
      }
    } catch (error) {
      toast.error("An error occurred while fetching data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [status]);

  const handleRequestResponse = async (
    requestId: string,
    newStatus: "accepted" | "declined"
  ) => {
    try {
      const response = await fetch(`/api/friends/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          throw new Error(errorJson.error || "An API error occurred.");
        } catch (e) {
          throw new Error(
            `Server responded with ${response.status}. Please check the API route.`
          );
        }
      }

      const responseText = await response.text();
      if (responseText) {
        const data = JSON.parse(responseText);
        toast.success(data.message || `Request ${newStatus}.`);
      } else {
        toast.success(`Request ${newStatus}.`);
      }

      fetchData();
      if (selectedFriend?.friendshipId === requestId) {
        setSelectedFriend(null);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "An unknown error occurred."
      );
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          My Connections
        </h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 flex flex-col gap-8">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Pending Requests ({pendingRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pendingRequests.length > 0 ? (
                  <div className="space-y-4">
                    {pendingRequests.map((req) => (
                      <div
                        key={req._id}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={req.requester.profilePhoto} />
                            <AvatarFallback>
                              {req.requester.name.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <p className="font-semibold">{req.requester.name}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() =>
                              handleRequestResponse(req._id, "accepted")
                            }
                            size="icon"
                            className="h-8 w-8 bg-green-500 hover:bg-green-600"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            onClick={() =>
                              handleRequestResponse(req._id, "declined")
                            }
                            size="icon"
                            className="h-8 w-8"
                            variant="destructive"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No pending requests.</p>
                )}
              </CardContent>
            </Card>
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  My Friends ({friends.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {friends.length > 0 ? (
                  friends.map((data) => (
                    <div
                      key={data.friendshipId}
                      onClick={() => setSelectedFriend(data)}
                      className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${
                        selectedFriend?.friendshipId === data.friendshipId
                          ? "bg-purple-100"
                          : "hover:bg-gray-100"
                      }`}
                    >
                      <Avatar>
                        <AvatarImage src={data.friend.profilePhoto} />
                        <AvatarFallback>
                          {data.friend.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <p className="font-semibold">{data.friend.name}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-sm">
                    Connect with others to see them here.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card className="shadow-lg h-[70vh] overflow-hidden">
              {selectedFriend && session?.user ? (
                <ChatBox
                  friendData={selectedFriend}
                  currentUser={session.user as User}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-center text-gray-500">
                  <p>Select a friend to start chatting.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
