import { useRef, useState, useEffect } from 'react'
import { Send, ImagePlus, Bot, Plus, Trash2, MessageSquareText, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import ChatMessage from '../components/ChatMessage.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  chatCompletion,
  fetchChats,
  createChat,
  fetchMessages,
  saveMessage,
  deleteChat as apiDeleteChat,
  isAuthenticated,
  isBackendError
} from '../api.js'

// Max accepted attachment size (raw file). Larger files are rejected before
// being read into memory; chatCompletion downscales for the AI request.
const MAX_IMAGE_FILE_BYTES = 4 * 1024 * 1024

function titleFromContent(content, image) {
  const c = typeof content === 'string' ? content.trim() : ''
  if (c) {
    const oneLine = c.replace(/\s+/g, ' ')
    return oneLine.length > 42 ? `${oneLine.slice(0, 42).trim()}…` : oneLine
  }
  return image ? 'Coin photo question' : 'New chat'
}

function formatTime(iso) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Math.max(0, Date.now() - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hr = Math.floor(mins / 60)
  const d = new Date(then)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (hr < 24) return `${hr} hr ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const INTRO = [
  { n: 1, title: 'Origin & country', desc: 'Read inscriptions and language to determine where the coin was struck.' },
  { n: 2, title: 'Mint year', desc: 'Locate the date on either face — often beneath the main design.' },
  { n: 3, title: 'Mint mark', desc: 'A small letter indicating the facility that produced the coin.' },
  { n: 4, title: 'Denomination', desc: 'The stated face value, usually in words or numerals.' },
  { n: 5, title: 'Grade & condition', desc: 'Assess wear on the highest points using standard grading scales.' }
]

export default function Chatbot() {
  const { user, ready: authReady } = useAuth()
  const [chats, setChats] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [attach, setAttach] = useState(null)
  const [attachError, setAttachError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const fileRef = useRef(null)
  const endRef = useRef(null)

  // Monotonic run token: incremented on every identity change so responses
  // and continuations from the previous account can never write into this
  // account's state (or trigger further API calls on its behalf).
  const runRef = useRef(0)

  // Monotonic view token: bumped whenever the visible conversation changes
  // (open chat, new chat, delete active, account switch). Late async results
  // (message loads, AI replies) from a previous view must never paint into
  // the conversation that is on screen now.
  const viewRef = useRef(0)

  const changeView = () => {
    viewRef.current += 1
    setTyping(false)
  }

  const showIntro = !activeId || messages.length === 0

  // Load the CURRENT account's conversations (server-side JWT scoping).
  // On every identity change:
  //   1. the previous account's chats/messages are wiped synchronously;
  //   2. in-flight replies from the previous account are invalidated;
  //   3. fetch errors leave the list EMPTY (never stale data).
  useEffect(() => {
    const run = ++runRef.current
    changeView()
    setChats([])
    setActiveId(null)
    setMessages([])
    setInput('')
    setAttach(null)
    setAttachError('')
    setDeleteError('')
    if (!authReady || !user) return undefined
    ;(async () => {
      try {
        const { chats: serverChats } = await fetchChats()
        if (run === runRef.current) setChats(Array.isArray(serverChats) ? serverChats : [])
      } catch (e) {
        console.warn('Unable to load chat history:', e?.message || e)
        if (run === runRef.current) setChats([])
      }
    })()
    return undefined
  }, [user?.id, authReady])

  useEffect(() => {
    // Only follow the conversation — never auto-scroll past the intro panel.
    if (messages.length === 0 && !typing) return
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, typing])

  const newChat = () => {
    changeView()
    setActiveId(null)
    setMessages([])
    setInput('')
    setAttach(null)
    setAttachError('')
  }

  const openChat = async (id) => {
    if (id === activeId) return
    const run = runRef.current
    const view = ++viewRef.current
    setTyping(false)
    setActiveId(id)
    setMessages([])
    setInput('')
    setAttach(null)
    setAttachError('')
    try {
      const res = await fetchMessages(id)
      // Ignore stale loads: identity changed or the user switched views.
      if (run !== runRef.current || view !== viewRef.current) return
      const loaded = (res.messages || []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        image: m.image || null,
        title: m.role === 'assistant' ? 'CoinScan AI' : undefined
      }))
      setMessages(loaded)
    } catch (e) {
      console.warn('Unable to load conversation:', e?.message || e)
      if (run === runRef.current && view === viewRef.current) setMessages([])
    }
  }

  const deleteChat = async (id) => {
    const run = runRef.current
    const isActive = activeId === id
    // Snapshots taken before the optimistic clear so a failed delete can
    // put the conversation back exactly as it was.
    const prevChats = chats
    const prevMessages = messages
    setDeleteError('')
    // Optimistically remove from the sidebar — restored below if the server
    // rejects the delete (a failed delete must never look successful).
    setChats((c) => c.filter((x) => x.id !== id))
    if (isActive) {
      changeView()
      setActiveId(null)
      setMessages([])
    }
    // Captured AFTER our own optimistic view bump: any later difference
    // means the user navigated, not us.
    const view = viewRef.current
    try {
      if (isAuthenticated()) await apiDeleteChat(id)
      // Success: if the account switched meanwhile, the identity effect has
      // already rebuilt the list — never touch it again.
      if (run !== runRef.current) return
    } catch (e) {
      console.warn('Unable to delete conversation:', e?.message || e)
      // A late failure from a previous account must never write into the
      // current account's state (list or error line).
      if (run !== runRef.current) return
      const idx = prevChats.findIndex((x) => x.id === id)
      const entry = idx >= 0 ? prevChats[idx] : null
      if (entry) {
        setChats((cur) => {
          if (cur.some((x) => x.id === id)) return cur
          const next = [...cur]
          next.splice(Math.max(0, Math.min(idx, next.length)), 0, entry)
          return next
        })
      }
      // Restore the open conversation only if the user has not navigated
      // elsewhere since — never clobber the view that is on screen now.
      if (isActive && view === viewRef.current) {
        setActiveId(id)
        setMessages(prevMessages)
      }
      setDeleteError('Could not delete this conversation. Please try again.')
    }
  }

  const send = async (text = input, image = attach) => {
    const content = text.trim()
    if ((!content && !image) || typing) return
    if (image && attachError) return

    const run = runRef.current
    const view = viewRef.current
    const identityChanged = () => run !== runRef.current
    // True when the user opened another conversation / New Chat while this
    // send was in flight: the reply still belongs to the originating chat
    // (persist it server-side) but must never be painted into the new view.
    const viewChanged = () => view !== viewRef.current

    const priorMessages = [...messages]
    const userMsg = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      content: content || 'I attached a coin photo.',
      image: image || null
    }

    setMessages((m) => [...m, userMsg])
    setInput('')
    setAttach(null)
    setAttachError('')
    setTyping(true)

    const toAI = (list) =>
      list
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content, image: m.image || undefined }))

    let chatId = activeId
    let savedUser = null

    if (isAuthenticated()) {
      try {
        if (!chatId) {
          const res = await createChat()
          if (identityChanged()) return
          chatId = res.chat.id
          if (!viewChanged()) setActiveId(chatId)
          setChats((c) => [
            {
              id: chatId,
              title: res.chat?.title || 'New chat',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messageCount: 0
            },
            ...c
          ])
        }
        const saved = await saveMessage(chatId, {
          role: 'user',
          content: userMsg.content,
          image: image || null
        })
        if (identityChanged()) return
        savedUser = saved.message
        if (!viewChanged()) {
          setMessages((m) =>
            m.map((x) => (x.id === userMsg.id ? { ...saved.message, image: image || null } : x))
          )
        }
        setChats((c) =>
          c.map((ch) => {
            if (ch.id !== chatId) return ch
            const title =
              ch.title === 'New chat' || !ch.title
                ? titleFromContent(userMsg.content, image)
                : ch.title
            return { ...ch, title, updatedAt: new Date().toISOString() }
          })
        )
      } catch (e) {
        console.warn('Could not save your message:', e?.message || e)
      }
    }

    const aiMessages = toAI([
      ...priorMessages,
      savedUser
        ? { role: 'user', content: savedUser.content, image: savedUser.image || null }
        : userMsg
    ])

    let reply
    let aiFailed = false
    const hasImage = Boolean(image)
    try {
      reply = await chatCompletion(aiMessages)
      if (!reply || !String(reply).trim()) throw new Error('Empty reply')
    } catch (e) {
      console.error(e)
      // Never invent answers when the AI service fails — show the real error.
      aiFailed = true
      reply =
        (isBackendError(e) && e.message) ||
        (hasImage
          ? "Sorry, I couldn't reliably analyze this image right now. Please try again with a clearer image."
          : 'Sorry, the AI service is unavailable right now. Please try again in a moment.')
    }

    // The account switched while the AI reply was in flight: the identity
    // effect already reset this view — never paint or persist old data.
    if (identityChanged()) return

    if (aiFailed) {
      // Show the failure in the conversation but don't persist it as an
      // assistant answer (it isn't one).
      if (!viewChanged()) {
        setMessages((m) => [
          ...m,
          { id: `tmp_err_${Date.now()}`, role: 'assistant', content: reply, title: 'CoinScan AI' }
        ])
        setTyping(false)
      }
      return
    }

    if (chatId && savedUser) {
      try {
        const saved = await saveMessage(chatId, { role: 'assistant', content: reply })
        if (identityChanged()) return
        // Always persist the reply to its own conversation server-side;
        // only paint it when that conversation is still on screen.
        if (!viewChanged()) {
          setMessages((m) => [...m, { ...saved.message, title: 'CoinScan AI' }])
          setTyping(false)
        }
        setChats((c) =>
          c.map((ch) =>
            ch.id === chatId
              ? { ...ch, updatedAt: new Date().toISOString(), messageCount: (ch.messageCount || 0) + 2 }
              : ch
          )
        )
        return
      } catch (e) {
        console.warn('Could not save the reply:', e?.message || e)
      }
    }
    if (!viewChanged()) {
      setMessages((m) => [
        ...m,
        { id: `tmp_${Date.now() + 1}`, role: 'assistant', content: reply, title: 'CoinScan AI' }
      ])
      setTyping(false)
    }
  }

  const onFile = (file) => {
    setAttachError('')
    if (!file) return
    // A rejected file must not leave a stale previous preview attached:
    // clear any current attachment so the preview and the error stay in
    // sync (and send() never silently no-ops on an attachError).
    if (!file.type.startsWith('image/')) {
      setAttach(null)
      setAttachError('Please choose an image file (JPG, PNG, WebP…).')
      return
    }
    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setAttach(null)
      setAttachError('Image is too large — maximum 4 MB. Please choose a smaller photo.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAttach(reader.result)
    reader.onerror = () => {
      setAttach(null)
      setAttachError('Could not read that file. Please try another image.')
    }
    reader.readAsDataURL(file)
  }

  return (
    <PageLayout>
      <PageHeader
        eyebrow="CoinScan Assistant"
        title={<><span>AI Numismatic </span><span className="teal">Assistant</span></>}
        subtitle="Ask questions about coin origin, history, market value, or minting errors."
      />

      <div style={{ display: 'grid', gap: 'clamp(16px, 2.2vw, 28px)' }} className="chat-grid">
        {/* LEFT — chat history */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <button className="btn btn-primary chat-new-btn" onClick={newChat}>
            <Plus size={16} /> New Chat
          </button>

          <div className="glass-card-soft chat-history-panel">
            <div className="chat-history-head">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <MessageSquareText size={14} />
                Chat History
              </span>
              <span className="sidebar-history-count">{chats.length}</span>
            </div>
            {deleteError && (
              <div
                className="chat-delete-error"
                data-testid="chat-delete-error"
                role="alert"
                style={{
                  fontSize: 12.5,
                  color: '#f5828a',
                  background: 'rgba(245,130,138,0.08)',
                  border: '1px solid rgba(245,130,138,0.3)',
                  borderRadius: 12,
                  padding: '9px 12px',
                  lineHeight: 1.45,
                  margin: '2px 10px 6px'
                }}
              >
                {deleteError}
              </div>
            )}
            <div className="chat-history-list">
              {chats.length === 0 ? (
                <div className="chat-history-empty">
                  <MessageSquareText size={22} style={{ color: 'var(--text-faint)', marginBottom: 6 }} />
                  No conversations yet.<br />Start a new chat below.
                </div>
              ) : (
                chats.map((chat) => {
                  const active = chat.id === activeId
                  return (
                    <div key={chat.id} className={`chat-history-item ${active ? 'active' : ''}`}>
                      <button className="chat-history-open" onClick={() => openChat(chat.id)} title={chat.title}>
                        <span className="chat-history-title">{chat.title}</span>
                        <span className="chat-history-time">{formatTime(chat.createdAt)}</span>
                      </button>
                      <button
                        className="chat-history-del"
                        onClick={() => deleteChat(chat.id)}
                        aria-label="Delete conversation"
                        title="Delete conversation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — chat panel */}
        <GlassCard className="glass-interior anim-fade-up anim-delay-1 chat-panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'clamp(520px, 66vh, 700px)' }}>
          <div className="chat-head" style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-faint)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`kbd live-dot`} />
            <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap' }}>CoinScan AI</span>
            <span className="chat-head-status" style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 0 }}>
              {showIntro ? 'Online · knowledge base ready' : 'Chatting with CoinScan AI'}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '22px 22px 10px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {showIntro && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg,#08745f,#00a98f)',
                    color: '#fff'
                  }}
                >
                  <Bot size={16} />
                </div>
                <div className="glass-card-soft glass-interior" style={{ padding: '14px 16px', borderRadius: 14, borderTopLeftRadius: 4, flex: 1, fontSize: 14.5, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Hello! I'm your AI Numismatic Assistant.</div>
                  <p style={{ margin: '0 0 10px' }}>Ask me anything about a coin's origin, history, market value, or minting errors — and I'll help you dig into the details.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {INTRO.map((s) => (
                      <div key={s.n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            flexShrink: 0,
                            background: 'rgba(0,229,195,0.12)',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--accent)',
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 2
                          }}
                        >
                          {s.n}
                        </span>
                        <div style={{ fontSize: 13.5 }}>
                          <strong style={{ color: 'var(--text-primary)' }}>{s.title}</strong>{' '}
                          <span style={{ color: 'var(--text-muted)' }}>— {s.desc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}

            {typing && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg,#08745f,#00a98f)',
                    color: '#fff'
                  }}
                >
                  <Bot size={16} />
                </div>
                <div className="glass-card-soft" style={{ padding: '12px 16px', borderRadius: 12, display: 'inline-flex', gap: 5, alignItems: 'center', borderTopLeftRadius: 4 }}>
                  <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div style={{ padding: '14px 18px 18px', borderTop: '1px solid var(--border-faint)' }}>
            {attachError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginBottom: 10,
                  fontSize: 12.5,
                  color: '#f5828a',
                  background: 'rgba(245,130,138,0.08)',
                  border: '1px solid rgba(245,130,138,0.3)',
                  borderRadius: 10,
                  padding: '7px 11px'
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                {attachError}
              </div>
            )}
            {attach && (
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
                <img src={attach} alt="Attachment" style={{ height: 68, width: 68, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border-strong)' }} />
                <button
                  onClick={() => setAttach(null)}
                  aria-label="Remove attachment"
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    width: 22, height: 22, borderRadius: 999,
                    background: 'rgba(245,130,138,0.9)', border: 'none', color: '#fff',
                    fontSize: 13, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/*"
                onChange={(e) => {
                  onFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: 12, borderRadius: 13, flexShrink: 0 }}
                onClick={() => fileRef.current?.click()}
                aria-label="Attach image"
              >
                <ImagePlus size={18} />
              </button>
              <input
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Ask CoinScan AI anything about coins..."
                style={{ padding: '13px 18px', borderRadius: 13, flex: 1 }}
              />
              <button
                className="btn btn-primary"
                style={{ padding: 13, borderRadius: 13, flexShrink: 0 }}
                onClick={() => send()}
                disabled={!input.trim() && !attach}
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
    </PageLayout>
  )
}