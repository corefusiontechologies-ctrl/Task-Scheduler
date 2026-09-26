import { NextResponse } from 'next/server';
import { DatabaseConfigurationError } from './db';
import { ValidationError } from './validation';
export { safeCsvCell } from './csv';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export async function requestJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ApiError(415, 'Content-Type must be application/json');
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body;
}

const PG_CLIENT_ERRORS = {
  '22P02': 'A value has an invalid format',
  '22003': 'A numeric value is out of range',
  '22007': 'A datetime value is out of range',
  '22012': 'A value is outside the allowed range',
  '23502': 'A required value is missing',
  '23514': 'A value failed a database constraint',
  '22P04': 'A JSON value could not be read',
  '40001': 'The request conflicted with another change, please retry',
  '40P01': 'The request deadlocked, please retry',
};

export function apiError(error) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, fields: error.fields }, { status: 400 });
  }
  if (error instanceof DatabaseConfigurationError) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }
  if (error?.code === '23505') {
    return NextResponse.json({ error: 'A record with that value already exists' }, { status: 409 });
  }
  if (error?.code === '23503') {
    return NextResponse.json({ error: 'A referenced record does not exist' }, { status: 400 });
  }
  const pgMessage = PG_CLIENT_ERRORS[error?.code];
  if (pgMessage) {
    console.error('Database rejected a request', error.code, error.message, error.detail || '', error.position || '');
    const status = error.code === '40001' || error.code === '40P01' ? 409 : 400;
    return NextResponse.json({ error: pgMessage }, { status });
  }
  console.error('API request failed', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export function withApi(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiError(error);
    }
  };
}

export function getAppUrl(request) {
  const configured = process.env.APP_URL;
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      throw new ApiError(500, 'APP_URL must use HTTPS');
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === 'production') throw new ApiError(500, 'APP_URL is not configured');
  return new URL(request.url).origin;
}

