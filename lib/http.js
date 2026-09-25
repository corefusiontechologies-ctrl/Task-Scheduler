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

