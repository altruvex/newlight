import pino from 'pino'

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',

    redact: {
        paths: [
            'userId',
            'email',
            'password',
            'token',
            'apiKey',
            'secret',
            'creditCard',
            '*.userId',
            '*.email',
            '*.password',
            '*.token'
        ],
        remove: true
    },

    base: {
        env: process.env.NODE_ENV
    }
})