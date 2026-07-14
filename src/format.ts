/**
 * This file is a modified derivative work of node-pg-format by datalanche.
 * Original code licensed under the MIT License.
 *
 * Copyright (c) 2014 Datalanche, Inc.
 * Modifications copyright (c) 2026 Roman Ditchuk (ISC License)
 */

// convert to Postgres default ISO 8601 format
function formatDate(date: string) {
    date = date.replace('T', ' ');
    date = date.replace('Z', '+00');
    return date;
}

function arrayToList(useSpace: boolean, array: any[], formatter: (d: any) => string) {
    let sql = '';

    sql += useSpace ? ' (' : '(';
    for (let i = 0; i < array.length; i++) {
        sql += (i === 0 ? '' : ', ') + formatter(array[i]);
    }
    sql += ')';

    return sql;
}

// Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
export function quoteIdent(value: any): string {

    if (value === undefined || value === null) {
        throw new Error('SQL identifier cannot be null or undefined');
    } else if (value === false) {
        return '"f"';
    } else if (value === true) {
        return '"t"';
    } else if (value instanceof Date) {
        return '"' + formatDate(value.toISOString()) + '"';
    } else if (value instanceof Buffer) {
        throw new Error('SQL identifier cannot be a buffer');
    } else if (Array.isArray(value)) {
        const temp = [];
        for (let i = 0; i < value.length; i++) {
            if (Array.isArray(value[i])) {
                throw new Error('Nested array to grouped list conversion is not supported for SQL identifier');
            } else {
                temp.push(quoteIdent(value[i]));
            }
        }
        return temp.toString();
    } else if (value === Object(value)) {
        throw new Error('SQL identifier cannot be an object');
    }

    const ident = value.toString().slice(0); // create copy

    let quoted = '"';

    for (let i = 0; i < ident.length; i++) {
        const c = ident[i];
        if (c === '"') {
            quoted += c + c;
        } else {
            quoted += c;
        }
    }

    quoted += '"';

    return quoted;
}

// Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
export function quoteLiteral(value: any): string {

    let literal = null;
    let explicitCast = null;

    if (value === undefined || value === null) {
        return 'NULL';
    } else if (value === false) {
        return "'f'";
    } else if (value === true) {
        return "'t'";
    } else if (value instanceof Date) {
        return "'" + formatDate(value.toISOString()) + "'";
    } else if (value instanceof Buffer) {
        return "E'\\\\x" + value.toString('hex') + "'";
    } else if (Array.isArray(value)) {
        const temp = [];
        for (let i = 0; i < value.length; i++) {
            if (Array.isArray(value[i])) {
                temp.push(arrayToList(i !== 0, value[i], quoteLiteral))
            } else {
                temp.push(quoteLiteral(value[i]));
            }
        }
        return temp.toString();
    } else if (value === Object(value)) {
        explicitCast = 'jsonb';
        literal = JSON.stringify(value);
    } else {
        literal = value.toString().slice(0); // create copy
    }

    let hasBackslash = false;
    let quoted = '\'';

    for (let i = 0; i < literal.length; i++) {
        const c = literal[i];
        if (c === '\'') {
            quoted += c + c;
        } else if (c === '\\') {
            quoted += c + c;
            hasBackslash = true;
        } else {
            quoted += c;
        }
    }

    quoted += '\'';

    if (hasBackslash) {
        quoted = 'E' + quoted;
    }

    if (explicitCast) {
        quoted += '::' + explicitCast;
    }

    return quoted;
}