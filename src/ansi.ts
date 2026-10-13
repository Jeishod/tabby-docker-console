/**
 * Minimal ANSI escape sequence → HTML converter for container log output.
 *
 * Supports SGR (Select Graphic Rendition) attributes:
 *   - reset (0), bold (1), dim (2), italic (3), underline (4), blink (5/6, ignored),
 *     inverse (7), hidden (8), strikethrough (9) and their "off" counterparts (21-29)
 *   - 8 / 16 standard colors (30-37, 40-47, 90-97, 100-107), default fg/bg (39/49)
 *   - 256-color palette (38;5;n / 48;5;n)
 *   - 24-bit true color (38;2;r;g;b / 48;2;r;g;b), including the colon sub-parameter form
 *
 * All other escape sequences (cursor movement, erase, OSC titles/hyperlinks …) are stripped.
 * Text content is always HTML-escaped, so the result is safe to bind via [innerHTML].
 *
 * Colors 0-15 are emitted as `var(--dc-ansi-N)` (foreground) / `var(--dc-ansi-bg-N)` (background)
 * so they can be themed in CSS, mirroring IntelliJ's separate console FOREGROUND/BACKGROUND colors.
 */

export interface AnsiLine {
    /** Plain text of the line with all escape sequences removed (used for filtering). */
    text: string
    /** HTML rendering of the line (escaped text wrapped in styled spans). */
    html: string
}

/** A color is either a palette index (0-255) or a CSS color string (true color). */
type Color = number | string | null

interface Style {
    fg: Color
    bg: Color
    bold: boolean
    dim: boolean
    italic: boolean
    underline: boolean
    inverse: boolean
    hidden: boolean
    strike: boolean
}

interface Segment {
    text: string
    style: Style
}

const DEFAULT_FG = 'var(--dc-ansi-default-fg)'
const DEFAULT_BG = 'var(--dc-ansi-default-bg)'

// CSI (ESC [ … final), OSC (ESC ] … BEL | ESC \), other 2-byte ESC sequences, line breaks.
// eslint-disable-next-line no-control-regex
const TOKEN_RE = /\x1b\[([0-9;:?<=>]*)[ -/]*([@-~])|\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b[@-_]|\r\n|\r|\n/g
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
// eslint-disable-next-line no-control-regex
const STRIP_RE = /\x1b\[[0-9;:?<=>]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b[@-_]/g

function defaultStyle (): Style {
    return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false, hidden: false, strike: false }
}

function isDefault (s: Style): boolean {
    return s.fg === null && s.bg === null && !s.bold && !s.dim && !s.italic &&
        !s.underline && !s.inverse && !s.hidden && !s.strike
}

function sameStyle (a: Style, b: Style): boolean {
    return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim &&
        a.italic === b.italic && a.underline === b.underline && a.inverse === b.inverse &&
        a.hidden === b.hidden && a.strike === b.strike
}

function escapeHtml (s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function clampByte (n: number): number {
    return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0
}

/** Converts a color to a CSS value. */
function colorCss (c: Color, background = false): string | null {
    if (c === null) {
        return null
    }
    if (typeof c === 'string') {
        return c
    }
    if (c < 16) {
        return background ? `var(--dc-ansi-bg-${c})` : `var(--dc-ansi-${c})`
    }
    if (c < 232) {
        // 6×6×6 color cube
        const i = c - 16
        const steps = [0, 95, 135, 175, 215, 255]
        const r = steps[Math.floor(i / 36)]
        const g = steps[Math.floor(i / 6) % 6]
        const b = steps[i % 6]
        return `rgb(${r},${g},${b})`
    }
    // grayscale ramp
    const v = 8 + (c - 232) * 10
    return `rgb(${v},${v},${v})`
}

/**
 * Parses an extended color definition (the values after 38/48).
 * Returns the color and how many params were consumed.
 */
function parseExtendedColor (params: number[]): [Color, number] {
    const mode = params[0]
    if (mode === 5 && params.length >= 2) {
        const idx = params[1]
        return [Number.isFinite(idx) ? clampByte(idx) : null, 2]
    }
    if (mode === 2 && params.length >= 4) {
        const [r, g, b] = params.slice(1, 4).map(clampByte)
        return [`rgb(${r},${g},${b})`, 4]
    }
    return [null, params.length]
}

function applySgr (style: Style, raw: string): Style {
    const s: Style = { ...style }
    const parts = raw === '' ? ['0'] : raw.split(';')

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]

        // Colon sub-parameter form, e.g. 38:2::255:0:0 or 38:5:208 or 4:3
        if (part.includes(':')) {
            const sub = part.split(':').map(x => (x === '' ? NaN : parseInt(x, 10)))
            const code = sub[0]
            if (code === 38 || code === 48) {
                const rest = sub.slice(1)
                let color: Color = null
                if (rest[0] === 5) {
                    color = Number.isFinite(rest[1]) ? clampByte(rest[1]) : null
                } else if (rest[0] === 2) {
                    // optional color-space id: 38:2:<cs>:r:g:b  or 38:2:r:g:b
                    const rgb = rest.slice(1).slice(-3).map(clampByte)
                    if (rgb.length === 3) {
                        color = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
                    }
                }
                if (code === 38) {
                    s.fg = color
                } else {
                    s.bg = color
                }
            } else if (code === 4) {
                s.underline = sub[1] !== 0
            }
            continue
        }

        const n = part === '' ? 0 : parseInt(part, 10)
        if (!Number.isFinite(n)) {
            continue
        }

        if (n === 0) {
            Object.assign(s, defaultStyle())
        } else if (n === 1) {
            s.bold = true
        } else if (n === 2) {
            s.dim = true
        } else if (n === 3) {
            s.italic = true
        } else if (n === 4) {
            s.underline = true
        } else if (n === 7) {
            s.inverse = true
        } else if (n === 8) {
            s.hidden = true
        } else if (n === 9) {
            s.strike = true
        } else if (n === 21 || n === 22) {
            s.bold = false
            s.dim = false
        } else if (n === 23) {
            s.italic = false
        } else if (n === 24) {
            s.underline = false
        } else if (n === 27) {
            s.inverse = false
        } else if (n === 28) {
            s.hidden = false
        } else if (n === 29) {
            s.strike = false
        } else if (n >= 30 && n <= 37) {
            s.fg = n - 30
        } else if (n === 39) {
            s.fg = null
        } else if (n >= 40 && n <= 47) {
            s.bg = n - 40
        } else if (n === 49) {
            s.bg = null
        } else if (n >= 90 && n <= 97) {
            s.fg = n - 90 + 8
        } else if (n >= 100 && n <= 107) {
            s.bg = n - 100 + 8
        } else if (n === 38 || n === 48) {
            const rest = parts.slice(i + 1).map(x => parseInt(x, 10))
            const [color, used] = parseExtendedColor(rest)
            if (n === 38) {
                s.fg = color
            } else {
                s.bg = color
            }
            i += used
        }
    }
    return s
}

function renderSegment (seg: Segment): string {
    const text = escapeHtml(seg.text)
    const st = seg.style
    if (isDefault(st)) {
        return text
    }

    let fg = colorCss(st.fg)
    let bg = colorCss(st.bg, true)
    if (st.inverse) {
        fg = colorCss(st.bg) ?? DEFAULT_BG
        bg = colorCss(st.fg, true) ?? DEFAULT_FG
    }

    const css: string[] = []
    if (st.hidden) {
        css.push('color:transparent')
    } else if (fg) {
        css.push(`color:${fg}`)
    }
    if (bg) {
        css.push(`background-color:${bg}`)
    }
    if (st.bold) {
        css.push('font-weight:bold')
    }
    if (st.dim) {
        css.push('opacity:0.6')
    }
    if (st.italic) {
        css.push('font-style:italic')
    }
    const deco: string[] = []
    if (st.underline) {
        deco.push('underline')
    }
    if (st.strike) {
        deco.push('line-through')
    }
    if (deco.length) {
        css.push(`text-decoration:${deco.join(' ')}`)
    }

    return css.length ? `<span style="${css.join(';')}">${text}</span>` : text
}

function renderLine (segments: Segment[]): AnsiLine {
    let text = ''
    let html = ''
    let pending: Segment | null = null
    for (const seg of segments) {
        if (!seg.text) {
            continue
        }
        text += seg.text
        if (pending && sameStyle(pending.style, seg.style)) {
            pending.text += seg.text
        } else {
            if (pending) {
                html += renderSegment(pending)
            }
            pending = { text: seg.text, style: seg.style }
        }
    }
    if (pending) {
        html += renderSegment(pending)
    }
    return { text, html }
}

/**
 * Splits raw log output into lines, each with plain text and colored HTML.
 * SGR state carries over across line breaks, like a real terminal.
 */
export function parseAnsiLines (input: string): AnsiLine[] {
    const lines: AnsiLine[] = []
    let style = defaultStyle()
    let segments: Segment[] = []
    let last = 0

    const pushText = (raw: string): void => {
        const t = raw.replace(CONTROL_RE, '')
        if (t) {
            segments.push({ text: t, style })
        }
    }

    TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TOKEN_RE.exec(input)) !== null) {
        if (m.index > last) {
            pushText(input.slice(last, m.index))
        }
        last = TOKEN_RE.lastIndex
        const tok = m[0]

        if (tok === '\n' || tok === '\r\n') {
            lines.push(renderLine(segments))
            segments = []
        } else if (tok === '\r') {
            // Bare carriage return followed by more text: that text overwrites the line
            // (progress bars). A trailing CR before a newline / end of input is ignored.
            const next = input.charAt(last)
            if (next !== '' && next !== '\r' && next !== '\n') {
                segments = []
            }
        } else if (m[2] === 'm') {
            style = applySgr(style, m[1] ?? '')
        }
        // any other escape sequence is dropped

        if (tok.length === 0) {
            TOKEN_RE.lastIndex++ // safety: never loop on an empty match
        }
    }
    if (last < input.length) {
        pushText(input.slice(last))
    }
    if (segments.length) {
        lines.push(renderLine(segments))
    }
    return lines
}

/** Removes all ANSI escape sequences from a string. */
export function stripAnsi (input: string): string {
    return input.replace(STRIP_RE, '')
}
