'use strict';

function developmentSettings(options, names = ['inspect'], defaults = {}) {
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => !names.includes(key)) ||
        Object.values(options).some(value => value !== undefined && typeof value !== 'boolean'))) {
        throw new TypeError(`development must contain only optional boolean ${names.join('/')} options.`);
    }
    const settings = { ...defaults };
    for (const [name, value] of Object.entries(options || {})) if (value !== undefined) settings[name] = value;
    if (process.env.NODE_ENV === 'production' && Object.values(settings).some(Boolean)) {
        throw new Error('Development features cannot be enabled in production.');
    }
    return settings;
}

module.exports = developmentSettings;
