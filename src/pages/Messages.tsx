import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BackChevron } from "../components/Icons";
import { Shell } from "../components/Shell";
import { StatusBanner } from "../components/StatusBanner";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";

export function MessagesPage() {
  const { user, loading } = useAuth();
  const threads = useQuery({
    queryKey: ["message-threads", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.messageThreads(),
  });

  return (
    <Shell width="narrow">
      <div className="flex flex-1 flex-col gap-3.5 pb-6 pt-6">
        <h1 className="m-0 font-display text-2xl font-semibold">Inbox</h1>

        {loading ? <StatusBanner title="Checking your session…" /> : null}
        {!user && !loading ? (
          <StatusBanner title="Sign in to read your messages" detail="Guests can write before they book." />
        ) : null}
        {user && threads.isLoading ? <StatusBanner title="Loading threads…" /> : null}
        {threads.isError ? (
          <StatusBanner
            tone="claim"
            title="Could not load messages"
            detail={threads.error instanceof Error ? threads.error.message : undefined}
          />
        ) : null}
        {user && threads.data && threads.data.length === 0 ? (
          <StatusBanner
            title="No threads yet"
            detail="Open a listing and write the host. The thread stays on that home."
          />
        ) : null}

        <div className="flex flex-col gap-3">
          {threads.data?.map((thread) => (
            <Link
              key={`${thread.listingId}:${thread.guestId}`}
              to={`/messages/${thread.listingId}/${thread.guestId}`}
              className="flex items-center gap-3 rounded-[14px] border border-linen-tint px-3.5 py-3 text-inherit no-underline"
            >
              <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[10px] bg-linen">
                {thread.listingPhoto ? (
                  <img src={thread.listingPhoto} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-bold">{thread.counterpartName}</span>
                  {thread.unreadCount > 0 ? (
                    <span
                      data-testid="thread-unread"
                      className="rounded-full bg-spruce px-2 py-0.5 text-[11px] font-bold text-paper"
                    >
                      {thread.unreadCount}
                    </span>
                  ) : null}
                </div>
                <span className="truncate text-xs text-ink/55">{thread.listingTitle}</span>
                <span className="truncate text-xs text-ink/70">{thread.lastBody}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}

export function MessageThreadPage() {
  const { listingId, guestId } = useParams<{ listingId: string; guestId: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const thread = useQuery({
    queryKey: ["thread", listingId, guestId],
    enabled: Boolean(user) && Boolean(listingId) && Boolean(guestId),
    queryFn: () => api.thread(listingId as string, guestId as string),
    retry: false,
  });

  useEffect(() => {
    if (!user || !listingId || !guestId || !thread.data) return;
    void api.markThreadRead(listingId, guestId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["unread"] });
      void queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    });
  }, [user, listingId, guestId, thread.data, queryClient]);

  const send = useMutation({
    mutationFn: () => {
      if (!listingId || !draft.trim()) throw new ApiError(400, "Write a message first");
      return api.sendMessage({
        listingId,
        guestId: thread.data?.viewerIsHost ? guestId : undefined,
        body: draft.trim(),
      });
    },
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["thread", listingId, guestId] });
      await queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
  });

  const notFound = thread.error instanceof ApiError && thread.error.status === 404;

  return (
    <Shell focused width="narrow">
      <div className="flex flex-1 flex-col pb-7 pt-6">
        <div className="mb-3.5 flex items-center gap-3">
          <button
            type="button"
            aria-label="Back to inbox"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-linen"
            onClick={() => navigate("/messages")}
          >
            <BackChevron />
          </button>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-bold">
              {thread.data?.counterpartName ?? "Thread"}
            </span>
            <span className="truncate text-xs text-ink/55">{thread.data?.listingTitle}</span>
          </div>
        </div>

        {loading || thread.isLoading ? <StatusBanner title="Loading this thread…" /> : null}
        {!user && !loading ? <StatusBanner title="Sign in to read this thread" /> : null}
        {user && notFound ? <StatusBanner title="Thread not found" /> : null}

        <div className="flex flex-1 flex-col gap-2.5">
          {thread.data?.messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                message.mine ? "ml-auto bg-spruce text-paper" : "bg-linen text-ink"
              }`}
            >
              {message.body}
            </div>
          ))}
          {thread.data && thread.data.messages.length === 0 ? (
            <StatusBanner title="No messages yet" detail="Write first. The host sees it on this home." />
          ) : null}
        </div>

        {user && thread.data ? (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <label className="flex flex-col gap-1 text-xs font-bold text-ink/60">
              MESSAGE
              <textarea
                required
                minLength={1}
                maxLength={4000}
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="rounded-lg border border-linen-tint px-3 py-2 text-sm font-normal text-ink"
              />
            </label>
            {send.isError ? (
              <StatusBanner
                tone="claim"
                title="Could not send that"
                detail={send.error instanceof ApiError ? send.error.message : undefined}
              />
            ) : null}
            <button
              type="submit"
              disabled={send.isPending || !draft.trim()}
              className="rounded-xl bg-spruce py-3.5 text-[15px] font-bold text-paper disabled:opacity-40 hover:bg-spruce-deep"
            >
              {send.isPending ? "Sending…" : "Send message"}
            </button>
          </form>
        ) : null}
      </div>
    </Shell>
  );
}

/** Guest shortcut: /messages/:listingId opens their thread on that listing. */
export function ListingMessageRedirect() {
  const { listingId } = useParams<{ listingId: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/login?next=/messages/${listingId}`, { replace: true });
      return;
    }
    if (listingId) navigate(`/messages/${listingId}/${user.id}`, { replace: true });
  }, [loading, user, listingId, navigate]);

  return (
    <Shell focused width="narrow">
      <div className="p-6">
        <StatusBanner title="Opening the thread…" />
      </div>
    </Shell>
  );
}
