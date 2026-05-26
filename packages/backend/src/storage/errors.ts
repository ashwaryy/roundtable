export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadRequestError'
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfirmationRequiredError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

export class IntegrityStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrityStorageError'
  }
}

export class StorageOperationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageOperationError'
  }
}
