import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator'

export function generateJobName(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2
  })
}
