import { Bot, User } from 'lucide-react'

// The chat bubble is plain text (whiteSpace: pre-line), so any raw markdown
// markers the model ever produced would show up literally. Strip them at
// render time so messages — including ones saved earlier — always display
// as clean, readable text. Layout, colors and sizing are untouched.
function plainText(text) {
  if (typeof text !== 'string' || !text) return text
  let t = text
    .replace(/```[^\n]*\n?/g, '\n')
    .replace(/```/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1$2')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^(\s*)\*(?=\s)/gm, '$1•')
    .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t
}

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user'
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '4px 0' }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 12,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isUser ? 'rgba(0,229,195,0.14)' : 'linear-gradient(135deg,#08745f,#00a98f)',
          border: '1px solid rgba(0,229,195,0.3)',
          color: isUser ? 'var(--accent)' : '#fff',
          boxShadow: 'var(--glow-soft)'
        }}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
            {isUser ? 'You' : 'CoinScan AI'}
          </span>
        </div>
        <div
          className={`glass-card-soft ${isUser ? '' : 'glass-interior'}`}
          style={{
            padding: '12px 15px',
            borderRadius: 14,
            fontSize: 14.5,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
            borderTopLeftRadius: isUser ? 14 : 4,
            whiteSpace: 'pre-line',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            maxWidth: '100%'
          }}
        >
          {plainText(message.content)}
          {message.image && (
            <div style={{ marginTop: 10 }}>
              <img
                src={message.image}
                alt="Attached coin photo"
                style={{
                  maxHeight: 220,
                  maxWidth: '100%',
                  borderRadius: 12,
                  border: '1px solid var(--border-soft)',
                  display: 'block'
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}