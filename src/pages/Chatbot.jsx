import { useRef, useState, useEffect } from 'react'
import { Send, ImagePlus, Bot, Plus, Trash2, MessageSquareText } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import GlassCard from '../components/GlassCard.jsx'
import ChatMessage from '../components/ChatMessage.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { chatCompletion } from '../api.js'

const CHAT_KEY = 'coinscan_chats'
const LEGACY_KEY = 'coinscan_chat'

function titleFromContent(content, image) {
  const c = typeof content === 'string' ? content.trim() : ''
  if (c) {
    const oneLine = c.replace(/\s+/g, ' ')
    return oneLine.length > 42 ? `${oneLine.slice(0, 42).trim()}…` : oneLine
  }
  return image ? 'Coin photo question' : 'New chat'
}

function loadChats() {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    if (raw) {
      const chats = JSON.parse(raw)
      if (Array.isArray(chats)) {
        return { chats, activeId: chats[0]?.id || null }
      }
    }
  } catch (e) {
    /* ignore */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const msgs = JSON.parse(legacy)
      if (Array.isArray(msgs) && msgs.length) {
        localStorage.removeItem(LEGACY_KEY)
        const first = msgs.find((m) => m.role === 'user')
        const chat = {
          id: `chat_${Date.now()}`,
          title: titleFromContent(first?.content, first?.image),
          messages: msgs,
          createdAt: new Date().toISOString()
        }
        return { chats: [chat], activeId: chat.id }
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { chats: [], activeId: null }
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

function respond(q) {
  const t = q.toLowerCase()

  if (t.includes('1939') && (t.includes('nickel') || t.includes('coin'))) {
    return {
      title: 'The 1939 Nickel',
      text:
        `The 1939 Jefferson nickel is a common-date U.S. coin, so most examples are worth only face value (about ₹40–₹120).\n\nHowever — the 1939-D "reverse strike" variety and the 1939-S can carry modest premiums:\n\n• 1939 (Philadelphia) — ₹100–₹500 in typical grades\n• 1939-D — ₹500–₹3,000 depending on condition\n• 1939-S — similar to the D\n\nHigh-grade specimens (MS66 or better) can reach several hundred dollars at auction because the 1939 issue frequently arrives weakly struck. Look for sharp full steps on the Monticello reverse — coins with "Full Steps" command the highest premiums.`
    }
  }
  if (t.includes('clean') || t.includes('silver')) {
    return {
      title: 'Safe Silver Coin Care',
      text:
        `Cleaning is the fastest way to destroy a coin's value. My best advice: almost never clean coins, and never use:\n\n• Abrasive polishes or toothpaste — they remove metal\n• Acid dips or ultrasonic cleaners for collectible pieces\n• Harsh rubbing that creates hairlines\n\nIf you must act:\n\n1. Soak in warm distilled water with a drop of pH-neutral dish soap\n2. Gently swish for a few minutes, then rinse\n3. Pat dry with a soft microfiber cloth\n\nLeave original "tone" intact — collectors pay premiums for natural, attractive toning. If a coin is corroded or valuable, a professional conservationist is the safest route.`
    }
  }
  if (t.includes('12-sided') || (t.includes('pound') && t.length < 40) || t.includes('side')) {
    return {
      title: 'The 12-Sided £1 Coin',
      text:
        `The United Kingdom's 12-sided £1 coin (introduced 2017) is one of the world's most secure circulation coins. Its security features:\n\n1. 12 sides — instantly distinguishable by touch and more difficult to counterfeit than circles\n2. Bi-metallic construction — a gold-coloured nickel-brass outer ring with a silver cupro-nickel inner disc\n3. Milled edges with "engrailing" — alternating smooth and milled edge segments\n4. Hidden features — a hologram-like image that changes between "£" and "1" when viewed from different angles\n5. Lettering on the edge — "DECUS ET TUTAMEN" inscribed into the metal\n\nIt was the largest coin redesign in UK circulating history.`
    }
  }
  if (t.includes('mint mark')) {
    return {
      title: 'Mint Marks Explained',
      text:
        `A mint mark is a small letter or symbol that identifies which facility struck a coin. It's usually tiny and easy to miss.\n\nCommon locations:\n\n• US coins — below the date on the obverse (D = Denver, S = San Francisco, P = Philadelphia)\n• Indian coins under Britain — below the date: C (Calcutta), B (Bombay), M (Madras)\n• Modern India — a small diamond, or "★"/"M" marks for Hyderabad and Kolkata on commemoratives\n\nWhy it matters: mint marks often determine rarity. For example, a balanced-date Indian series coin with a South African watermark mint mark can be dramatically rarer — and worth many multiples of a common equivalent.`
    }
  }
  if (t.includes('market value') || t.includes('valuable') || t.includes('worth')) {
    return {
      title: 'What Drives Coin Value?',
      text:
        `Coin value is governed by five pillars, in roughly this order of importance:\n\n1. Rarity — how many survive and how many are available for sale\n2. Condition / grade — the higher the grade, the steeper the price curve\n3. Demand — collector fashion, key dates, and iconic designs\n4. Metal content — bullion value forms the "floor"\n5. Provenance — famous collections and history add premium\n\nPractical guidance: check mintage figures, compare recent Certified Auction results (not asking prices), and be wary of "rare" coins sold below market — a bargain price is often a sign of a counterfeit or altered coin.`
    }
  }
  if (t.includes('grade') || t.includes('grading')) {
    return {
      title: 'How Grading Works',
      text:
        `Grading describes a coin's condition on the Sheldon scale (1–70):\n\n• MS/PR 60-70 — Mint State / Proof, no circulation wear\n• AU 50-58 — About Uncirculated, wear on highest points only\n• EF/XF 40-45 — Extremely Fine, light wear, all details bold\n• VF 20-35 — Very Fine, moderate wear, major features clear\n• F 12-15 — Fine, considerable wear\n• VG 8-10 — Very Good, outline of design\n• G 4-6 — Good, heavily worn\n\nStep-by-step approach:\n\n1. Photograph both faces under even light\n2. Examine the highest points (hair, feathers, cheek) for wear\n3. Compare against known photos at each grade\n4. Measure strike, luster, and eye appeal\n\nFor serious value, rely on professional services (NGC, PCGS, or the service your platform supports). My estimates assume the described grade.`
    }
  }
  if (t.includes('proof') || t.includes('circulation')) {
    return {
      title: 'Proof vs Circulation Coins',
      text:
        `The difference is manufacturing, not denomination:\n\n• Proof coins — struck twice with specially polished dies on burnished planchets. Mirrored fields, frosted devices, packaged individually. Made for collectors.\n\n• Circulation coins — struck once, mass-produced for everyday use. Luster is more uniform and surfaces show mint-made marks.\n\nHow to tell: proofs have razor-sharp detail and a mirror finish; circulating coins show a satin, textured surface. Many mints sell both versions of the same design. Proofs almost always carry a premium — but note that proof status alone doesn't guarantee value; rarity and grade still rule.`
    }
  }
  if (t.includes('error') || t.includes('mint') || t.includes('strike')) {
    return {
      title: 'Minting Errors & Varieties',
      text:
        `Mint errors are among the most collectible modern coins. The main families:\n\n1. Die errors — cracks, cuds, doubled dies (e.g., the famous 1955 double-die Lincoln)\n2. Planchet errors — wrong metal, clipped or off-center planchets\n3. Strike errors — off-center strikes, broadstrikes, brockages, die caps\n4. Edge errors — missing or double lettering\n\nA genuinely struck-through or off-center error can fetch 10–100× face value. To verify: measure the degree of error (percentage off-center matters), confirm it isn't post-mint damage, and check for official certification.`
    }
  }
  if (t.includes('hii') || t.includes('hi ') || t.includes('hello') || t.includes('hey') || t.includes('start')) {
    return {
      title: 'Hello!',
      text: `Great to see you. Ask me about any coin — origin, history, market value, grading, mint marks, or errors. You can also upload a photo from the identification tab and I'll help decode what you're holding.`
    }
  }
  return {
    title: 'Here is what I found',
    text:
      `Great question! Based on what you described, here's how to approach it:\n\n1. Identify the coin's origin — check the language, inscriptions, and design motifs\n2. Confirm the denomination and year from the legends\n3. Assess condition against standard grading descriptions\n4. Compare against recent verified sale results rather than listed prices\n\nIf you can share the country, approximate year, or a photo, I can give a much more specific answer. You can upload an image from the Home tab and get an instant AI identification.`
  }
}

const INTRO = [
  { n: 1, title: 'Origin & country', desc: 'Read inscriptions and language to determine where the coin was struck.' },
  { n: 2, title: 'Mint year', desc: 'Locate the date on either face — often beneath the main design.' },
  { n: 3, title: 'Mint mark', desc: 'A small letter indicating the facility that produced the coin.' },
  { n: 4, title: 'Denomination', desc: 'The stated face value, usually in words or numerals.' },
  { n: 5, title: 'Grade & condition', desc: 'Assess wear on the highest points using standard grading scales.' }
]

export default function Chatbot() {
  const [{ chats, activeId }, setState] = useState(loadChats)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [attach, setAttach] = useState(null)
  const fileRef = useRef(null)
  const endRef = useRef(null)

  const activeChat = chats.find((c) => c.id === activeId) || null
  const messages = activeChat?.messages || []
  const showIntro = !activeChat || messages.length === 0

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(chats))
    } catch (e) {
      /* ignore */
    }
  }, [chats])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, typing])

  const newChat = () => {
    setState((s) => ({ ...s, activeId: null }))
    setInput('')
    setAttach(null)
  }

  const openChat = (id) => {
    setState((s) => ({ ...s, activeId: id }))
    setInput('')
    setAttach(null)
  }

  const deleteChat = (id) => {
    setState((s) => {
      let nextActive = s.activeId
      if (s.activeId === id) nextActive = null
      return { chats: s.chats.filter((c) => c.id !== id), activeId: nextActive }
    })
  }

  const appendMessage = (chatId, msg) => {
    setState((s) => {
      const exists = s.chats.some((c) => c.id === chatId)
      if (!exists) {
        const chat = {
          id: chatId,
          title: titleFromContent(msg.content, msg.image),
          messages: [msg],
          createdAt: new Date().toISOString()
        }
        return { chats: [chat, ...s.chats], activeId: chatId }
      }
      return {
        ...s,
        chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, msg] } : c))
      }
    })
  }

  const send = async (text = input, image = attach) => {
    const content = text.trim()
    if ((!content && !image) || typing) return

    let targetId = activeId
    if (!targetId) targetId = `chat_${Date.now()}`

    const baseMessages = activeChat?.id === targetId ? activeChat.messages : []
    const userMsg = { id: Date.now(), role: 'user', content: content || 'I attached a coin photo.', image }

    appendMessage(targetId, userMsg)
    setInput('')
    setAttach(null)
    setTyping(true)

    try {
      const reply = await chatCompletion([...baseMessages, userMsg])
      appendMessage(targetId, { id: Date.now() + 1, role: 'assistant', content: reply, title: 'CoinScan AI' })
    } catch (e) {
      console.error(e)
      const r = respond(content || 'coin')
      appendMessage(targetId, { id: Date.now() + 1, role: 'assistant', content: r.text, title: r.title })
    } finally {
      setTyping(false)
    }
  }

  const onFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setAttach(reader.result)
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
        <GlassCard className="glass-interior anim-fade-up anim-delay-1" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'clamp(520px, 66vh, 700px)' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-faint)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`kbd live-dot`} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>CoinScan AI</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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