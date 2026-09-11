import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ListingPhoto } from "../components/ListingPhoto";
import { Shell } from "../components/Shell";
import { SignInPrompt } from "../components/SignInPrompt";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusMessage,
  StatusPill,
  Textarea,
} from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { api, ApiError } from "../lib/api";
import type { MessageItem } from "../lib/types";

/** A timestamp a person can read, in their own zone — a message is not a stay. */
function messageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessagesPage() {
  const { user, status } = useAuth();
  const threads = useQuery({
    queryKey: ["message-threads", user?.id],
    enabled: Boolean(user),
    queryFn: () => api.messageThreads(),
  });

  const rows = threads.data ?? [];

  return (
    <Shell width="narrow" title="Messages">
      <div className="flex flex-1 flex-col gap-6 py-6 sm:py-8">
        {status !== "signed_in" ? (
          <SignInPrompt
            title="Sign in to read your messages"
            description="A conversation is private to the two people in it. We'll bring you straight back here."
          />
        ) : (
          <>
            <PageHeader
              title="Messages"
              description="One conversation per home, between you and the other person on it."
            />

            {threads.isPending ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                <p role="status" className="sr-only">
                  Loading your conversations
                </p>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : threads.isError ? (
              <StatusMessage
                tone="danger"
                title="We couldn't load your messages."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void threads.refetch()}>
                    Try again
                  </Button>
                }
              >
                <p>Nothing was lost — this is about reaching the server.</p>
              </StatusMessage>
            ) : rows.length === 0 ? (
              <EmptyState
                title="No conversations yet."
                action={<ButtonLink to="/explore">Find a home</ButtonLink>}
              >
                <p>Open a home and write to its host. The conversation stays attached to that home.</p>
              </EmptyState>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {rows.map((thread) => (
                  <li key={`${thread.listingId}:${thread.guestId}`}>
                    <Card padding="sm">
                      <div className="flex gap-4">
                        <div className="w-16 shrink-0">
                          <ListingPhoto src={thread.listingPhoto} alt="" className="rounded-card" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="m-0 font-semibold">
                              <Link to={`/messages/${thread.listingId}/${thread.guestId}`}>
                                {thread.counterpartName}
                              </Link>
                            </p>
                            {thread.unreadCount > 0 ? (
                              <span data-testid="thread-unread">
                                <StatusPill tone="brand">
                                  {thread.unreadCount} unread
                                </StatusPill>
                              </span>
                            ) : null}
                          </div>
                          <p className="m-0 truncate text-sm text-ink-secondary">{thread.listingTitle}</p>
                          <p className="m-0 truncate text-sm text-ink-secondary">{thread.lastBody}</p>
                          <p className="m-0 text-sm text-ink-secondary">{messageTime(thread.lastAt)}</p>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

function Bubble({ message, counterpartName }: { message: MessageItem; counterpartName: string }) {
  const author = message.mine ? "You" : counterpartName;
  return (
    <li className={`flex flex-col gap-1 ${message.mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-card px-4 py-3 ${
          message.mine ? "bg-brand text-white" : "bg-surface text-ink"
        }`}
      >
        {/* The author is in the text, not only in the alignment and colour. */}
        <p className="m-0 whitespace-pre-line">
          <span className="sr-only">{author}: </span>
          {message.body}
        </p>
      </div>
      <p className="m-0 text-sm text-ink-secondary">
        <span aria-hidden>{author} · </span>
        {messageTime(message.createdAt)}
      </p>
    </li>
  );
}

/**
 * One conversation.
 *
 * What is typed here lives in component state and nowhere else. A message is
 * private to two people, and a half-written one is more private still, so it
 * is never written to this device's storage — a shared browser would hand it
 * to whoever opened the page next. The consequence is that it survives a
 * failed send and a retry, but not a closed tab, and the page says so rather
 * than letting someone assume otherwise.
 */
export function MessageThreadPage() {
  const { listingId, guestId } = useParams<{ listingId: string; guestId: string }>();
  const { user, status } = useAuth();
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
    mutationFn: (body: string) => {
      if (!listingId || !body.trim()) throw new ApiError(400, "Write a message first");
      return api.sendMessage({
        listingId,
        guestId: thread.data?.viewerIsHost ? guestId : undefined,
        body: body.trim(),
      });
    },
    // Only a send the server accepted clears the box. A failed one leaves
    // every character where it was, so a retry costs nothing.
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["thread", listingId, guestId] });
      await queryClient.invalidateQueries({ queryKey: ["message-threads"] });
    },
  });

  const notFound = thread.error instanceof ApiError && thread.error.status === 404;

  if (status !== "signed_in") {
    return (
      <Shell focused width="narrow" title="Conversation" backTo="/messages" backLabel="Messages">
        <div className="py-8">
          <SignInPrompt
            title="Sign in to open this conversation"
            description="We'll bring you back to this conversation."
          />
        </div>
      </Shell>
    );
  }

  if (thread.isPending) {
    return (
      <Shell focused width="narrow" title="Conversation" backTo="/messages" backLabel="Messages">
        <div className="flex flex-1 flex-col gap-3 py-8" aria-busy="true">
          <p role="status" className="sr-only">
            Loading this conversation
          </p>
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="ml-auto h-16 w-2/3" />
        </div>
      </Shell>
    );
  }

  if (notFound || !thread.data) {
    return (
      <Shell focused width="narrow" title="Conversation" backTo="/messages" backLabel="Messages">
        <div className="flex flex-1 flex-col gap-6 py-12">
          <PageHeader
            title="We couldn't find this conversation."
            description="It may not be yours, or the link may be out of date."
          />
          <ButtonLink to="/messages" className="self-start">
            Your messages
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  const data = thread.data;

  return (
    <Shell focused width="narrow" title="Conversation" backTo="/messages" backLabel="Messages">
      <div className="flex flex-1 flex-col gap-6 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[1.5rem]">{data.counterpartName}</h1>
          <p className="m-0 text-sm text-ink-secondary">
            About{" "}
            <Link to={`/listing/${data.listingId}`} className="font-semibold">
              {data.listingTitle}
            </Link>
            {data.viewerIsHost ? " · you're the host on this home" : " · you're the guest here"}
          </p>
        </div>

        {data.messages.length === 0 ? (
          <EmptyState title="No messages yet.">
            <p>
              Write the first one. {data.counterpartName} sees it against this home, and only the two of
              you can read it.
            </p>
          </EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-4 p-0">
            {data.messages.map((message) => (
              <Bubble key={message.id} message={message} counterpartName={data.counterpartName} />
            ))}
          </ul>
        )}

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) send.mutate(draft);
          }}
        >
          <Textarea
            id="message-body"
            label={`Message ${data.counterpartName}`}
            rows={4}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />

          {send.isError ? (
            <StatusMessage
              tone="danger"
              title="Your message wasn't sent."
              action={
                <Button variant="secondary" size="sm" busy={send.isPending} onClick={() => send.mutate(draft)}>
                  Try again
                </Button>
              }
            >
              <p>
                {send.error instanceof ApiError
                  ? send.error.message
                  : "Something went wrong on the way to the server."}{" "}
                What you wrote is still here.
              </p>
            </StatusMessage>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={!draft.trim()}
              busy={send.isPending}
              busyLabel="Sending your message…"
            >
              Send message
            </Button>
            <p className="m-0 text-sm text-ink-secondary">
              Kept on this page only — closing the tab discards anything unsent.
            </p>
          </div>
        </form>
      </div>
    </Shell>
  );
}

/** Guest shortcut: /messages/:listingId opens their thread on that listing. */
export function ListingMessageRedirect() {
  const { listingId } = useParams<{ listingId: string }>();
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const validId = Boolean(listingId && /^[A-Za-z0-9-]{1,64}$/.test(listingId));

  useEffect(() => {
    if (status !== "signed_in" || !user || !validId) return;
    navigate(`/messages/${listingId}/${user.id}`, { replace: true });
  }, [status, user, listingId, validId, navigate]);

  return (
    <Shell focused width="narrow" backTo="/messages" backLabel="Messages">
      <div className="flex flex-1 flex-col gap-6 py-8">
        {!validId ? (
          <StatusMessage tone="warning" title="We couldn't find that conversation.">
            <p>The link may be out of date.</p>
          </StatusMessage>
        ) : status === "signed_in" ? (
          <p role="status" className="m-0 text-ink-secondary">
            Opening your conversation…
          </p>
        ) : (
          <SignInPrompt
            title="Sign in to message this host"
            description="We'll bring you back to this conversation. Nothing is sent until you write a message."
            source="listing_message"
          />
        )}
        {!validId || status === "signed_out" ? (
          <Link to="/explore" className="text-sm font-semibold">
            Find a home
          </Link>
        ) : null}
      </div>
    </Shell>
  );
}
