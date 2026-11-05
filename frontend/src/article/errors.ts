export class ArticleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class MemoNotFoundError extends ArticleError {
  constructor(id: string) {
    super(`Memo not found: ${id}`)
  }
}

export class InvalidMemoError extends ArticleError {}

export class MemoAlreadyExistsError extends ArticleError {
  constructor(id: string) {
    super(`Memo already exists: ${id}`)
  }
}

export class InvalidHeadingError extends ArticleError {
  constructor(index: number) {
    super(`No ATX heading marker at body index ${index.toString()}`)
  }
}

export class InvalidBlockMoveError extends ArticleError {}

export class InvalidSourceError extends ArticleError {}

export class SourceAlreadyExistsError extends ArticleError {
  constructor(id: string) {
    super(`Source already exists: ${id}`)
  }
}

export class SourceNotFoundError extends ArticleError {
  constructor(id: string) {
    super(`Source not found: ${id}`)
  }
}
