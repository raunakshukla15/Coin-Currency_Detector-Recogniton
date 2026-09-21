import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Upload, ScanLine, X, FileImage, Sparkles, RefreshCw } from 'lucide-react'
import PageHeader from '../components/PageHeader.jsx'
import Button from '../components/Button.jsx'
import Modal from '../components/Modal.jsx'
import PageLayout from '../components/PageLayout.jsx'
import { identifyItems } from '../api.js'

const HISTORY_KEY = 'coinscan_history'

function saveHistory(items, image) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return
    const first = Array.isArray(items) ? items[0] : items
    const name = first?.name || 'Identified Coin'
    list.unshift({
      id: `${Date.now()}`,
      name,
      image: image || null,
      items,
      timestamp: new Date().toISOString()
    })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)))
    window.dispatchEvent(new Event('coinscan-history'))
  } catch (e) {
    /* ignore */
  }
}

export default function Home() {
  const nav = useNavigate()
  const fileRef = useRef(null)
  const videoRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [fileName, setFileName] = useState('')
  const [scanning, setScanning] = useState(false)
  const [camOpen, setCamOpen] = useState(false)
  const [camError, setCamError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [scanError, setScanError] = useState('')
  const streamRef = useRef(null)

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCamOpen(false)
  }

  useEffect(() => () => stopStream(), [])

  const onPick = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      setPreview(reader.result)
      setFileName(file.name)
      setScanError('')
      if (camOpen) stopStream()
    }
    reader.readAsDataURL(file)
  }

  const openCamera = async () => {
    setCamError('')
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamError('Camera is not supported in this browser. Please try the upload option instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      setCamOpen(true)
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current
          videoRef.current.play().catch(() => {})
        }
      }, 80)
    } catch (err) {
      setCamError('Unable to access the camera. Permission may be denied or no camera is connected. Please upload an image instead.')
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    setPreview(dataUrl)
    setFileName('camera-capture.png')
    stopStream()
  }

  const detect = async () => {
    if (!preview) return
    setScanning(true)
    setScanError('')
    try {
      const items = await identifyItems(preview)
      saveHistory(items, preview)
      sessionStorage.setItem('coinscan_lastident', JSON.stringify({ items, image: preview || null }))
      nav('/result')
    } catch (e) {
      console.error(e)
      setScanError('Unable to identify the image. Please try another, clearer photo.')
    } finally {
      setScanning(false)
    }
  }

  const reset = () => {
    setPreview(null)
    setFileName('')
    setScanning(false)
    setScanError('')
  }

  return (
    <PageLayout>
      <div
        style={{
          height: 'calc(100vh - 124px)',
          minHeight: 460,
          display: 'flex',
          flexDirection: 'column',
          gap: 14
        }}
      >
        <PageHeader
          compact
          eyebrow="Welcome to CoinScan"
          title={<><span>Discover </span><span className="teal">Coins</span></>}
          subtitle="Identify, explore, and learn about coins from around the world."
        />

        <div
          className="glass-card glass-interior anim-fade-up"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            padding: 'clamp(12px, 1.5vw, 20px)'
          }}
        >
          <div
            className="dropzone-dashed"
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              overflow: 'hidden',
              ...(dragOver ? { borderColor: 'var(--accent)', background: 'rgba(0,229,195,0.05)', boxShadow: 'var(--glow-soft)' } : {})
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              onPick(e.dataTransfer.files?.[0])
            }}
            onClick={() => !scanning && !preview && fileRef.current?.click()}
          >
            {scanning && <div className="scan-line" />}

            {preview ? (
              <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 16 }}>
                <div style={{ position: 'relative', maxWidth: 300, width: '100%' }}>
                  <img
                    src={preview}
                    alt="Preview of the coin to identify"
                    style={{
                      width: '100%',
                      maxHeight: 250,
                      objectFit: 'contain',
                      borderRadius: 18,
                      border: '1px solid var(--border-strong)',
                      boxShadow: 'var(--glow), var(--shadow-deep)'
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      reset()
                    }}
                    aria-label="Remove image"
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: 'rgba(3,25,21,0.85)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <X size={15} />
                  </button>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 10,
                      left: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(3,25,21,0.85)',
                      border: '1px solid var(--border-soft)',
                      borderRadius: 10,
                      padding: '6px 11px',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      maxWidth: '70%'
                    }}
                  >
                    <FileImage size={13} style={{ color: 'var(--accent)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                  Image ready for identification
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    background: 'rgba(0,229,195,0.1)',
                    border: '1px solid rgba(0,229,195,0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    boxShadow: 'var(--glow)'
                  }}
                >
                  <ScanLine size={28} />
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 14, letterSpacing: '-0.01em' }}>
                  Upload a Coin Image
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                  Upload a clear photo of a coin<br />to identify it.
                </div>
              </>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 14,
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            {preview && !scanning ? (
              <>
                <Button variant="primary" size="md" onClick={detect} style={{ minWidth: 200 }}>
                  <Sparkles size={17} /> Detect Coin
                </Button>
                <Button variant="ghost" size="md" onClick={reset} style={{ minWidth: 200 }}>
                  <RefreshCw size={17} /> Remove
                </Button>
              </>
            ) : scanning ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 600, color: 'var(--accent)', padding: '12px 26px' }}>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                </span>
                Analyzing coin features…
              </div>
            ) : scanError ? (
              <>
                <Button variant="primary" size="md" onClick={detect} style={{ minWidth: 200 }}>
                  <RefreshCw size={17} /> Try Again
                </Button>
                <Button variant="ghost" size="md" onClick={reset} style={{ minWidth: 200 }}>
                  <Upload size={17} /> New Image
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" size="md" onClick={() => fileRef.current?.click()} style={{ minWidth: 200 }}>
                  <Upload size={17} /> Upload an Image
                </Button>
                <Button variant="ghost" size="md" onClick={openCamera} style={{ minWidth: 200 }}>
                  <Camera size={17} /> Use Camera
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onPick(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {scanError && (
        <Modal open onClose={() => setScanError('')} title="Identification Failed" width={480}>
          <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 20px' }}>
            {scanError}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="md" onClick={() => setScanError('')}>Close</Button>
            <Button variant="primary" size="md" onClick={detect}>
              <RefreshCw size={16} /> Try Again
            </Button>
          </div>
        </Modal>
      )}

      {camError && (
        <Modal open onClose={() => setCamError('')} title="Camera Unavailable" width={480}>
          <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 20px' }}>
            {camError}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="md" onClick={() => setCamError('')}>Close</Button>
            <Button variant="primary" size="md" onClick={() => { setCamError(''); fileRef.current?.click() }}>
              <Upload size={16} /> Upload Instead
            </Button>
          </div>
        </Modal>
      )}

      <Modal open={camOpen} onClose={stopStream} title="Camera" width={720}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--border-strong)', background: '#000' }}>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{ width: '100%', maxHeight: 480, objectFit: 'contain', display: 'block' }}
            />
            <div style={{ position: 'absolute', inset: '12%', border: '1.5px dashed rgba(0,229,195,0.7)', borderRadius: 9999, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, background: 'linear-gradient(180deg, transparent 60%, rgba(0,229,195,0.08))', pointerEvents: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Button variant="ghost" size="md" onClick={stopStream}>
              <X size={16} /> Cancel
            </Button>
            <Button variant="primary" size="md" onClick={capture}>
              <Camera size={16} /> Capture
            </Button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  )
}