// Based on the strip-ansi package (MIT license, Sindre Sorhus).
function ansiRegex({ onlyFirst = false } = {}): RegExp {
  const ST = '(?:\\u0007|\\u001B\\u005C|\\u009C)'

  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`

  const csi =
    '[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]'

  const pattern = `${osc}|${csi}`

  return new RegExp(pattern, onlyFirst ? undefined : 'g')
}

const regex = ansiRegex()

export function stripAnsi(string: string): string {
  if (typeof string !== 'string') {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``)
  }

  if (!string.includes('') && !string.includes('')) {
    return string
  }

  return string.replace(regex, '')
}

export function stripControlChars(string: string): string {
  let out = ''
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      out += string[i]
    }
  }
  return out
}
