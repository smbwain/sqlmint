import * as pgFormat from 'pg-format';

export class WithRawSql<T = never> {
    constructor(
        public rawSql: string,
    ) {}
    public _packF: PackFunction<any, T>;
    public pack<R>(pf: PackFunction<T, R>): WithRawSql<R> {
        const res = new WithRawSql<R>(this.rawSql);
        res._packF = pf;
        return res;
    }
}

export type PackFunction<T, R> = (v: T) => R;

export const config: {
    customSerialize?: (val: any) => string | null;
} = {};

export const serialize = (val: any): string => {
    const custom = config.customSerialize?.(val);
    if (custom) {
        return custom;
    }
    if (val instanceof WithRawSql) {
        return val.rawSql;
    }
    if (Array.isArray(val)) {
        return `(${val.map(item => serialize(item)).join(',')})`;
    } else {
        return pgFormat.literal(val);
    }
};

export function sql<T = never>(template: TemplateStringsArray, ...params: any[]): WithRawSql<T> {
    const res: string[] = [];
    params.forEach((param, index) => {
        res.push(template[index], serialize(param));
    });
    res.push(template[template.length-1]);
    return sql.raw(res.join(''));
}

sql.raw = (rawSql: string): WithRawSql => new WithRawSql(rawSql);

sql.list = (items: any[]): WithRawSql => sql.raw(`(${items.map(item => serialize(item)).join(',')})`);

sql.values = (rows: any[][]): WithRawSql => sql.raw(`(VALUES ${rows.map(row => `(${row.map(value => serialize(value)).join(',')})`).join(',')})`);

sql.insert = (data: Record<string, any>): WithRawSql => {
    const keys = Object.keys(data).filter(key => data[key] !== undefined);
    if (!keys.length) {
        throw new Error('No keys to insert');
    }
    return sql.raw(
        `(${keys.map(key => pgFormat.ident(key)).join(',')}) VALUES (${keys.map(key => serialize(data[key])).join(',')})`,
    );
}

sql.multiInsert = (list: Array<Record<string, any>>): WithRawSql => {
    if (!list.length) {
        throw new Error('No data to insert');
    }
    const keys = Object.keys(list[0]).filter(key => list[0][key] !== undefined);
    return sql.raw(
        `(${keys.map(key => pgFormat.ident(key)).join(',')}) VALUES ${list.map(data => `(${keys.map(key => serialize(data[key])).join(',')})`)}`,
    );
};

sql.array = (items: any[]): WithRawSql => sql.raw(
    `ARRAY[${items.map(item => serialize(item)).join(',')}]`,
);

sql.set = (data: Record<string, any>): WithRawSql => {
    const keys = Object.keys(data).filter(key => data[key] !== undefined);
    if (!keys.length) {
        throw new Error('No keys to update');
    }
    return sql.raw(
        keys.map(key => `${pgFormat.ident(key)}=${serialize(data[key])}`).join(','),
    );
};

sql.where = (
    conditions: Array<WithRawSql | null | undefined>,
    op: 'AND' | 'OR' = 'AND',
    defaultCondition?: WithRawSql,
): WithRawSql => {
    const filteredCondition = conditions.filter((c): c is WithRawSql => !!c).map(c => `(${c.rawSql})`);
    if (filteredCondition.length === 0) {
        if (!defaultCondition) {
            throw new Error('No conditions');
        }
        return defaultCondition;
    }
    return sql.raw(filteredCondition.join(` ${op} `));
}

sql.and = (conditions: Array<WithRawSql | null | undefined>, defaultCondition?: WithRawSql): WithRawSql => sql.where(conditions, 'AND', defaultCondition);
sql.or = (conditions: Array<WithRawSql | null | undefined>, defaultCondition?: WithRawSql): WithRawSql => sql.where(conditions, 'OR', defaultCondition);

sql.ident = (s: string): WithRawSql => sql.raw(pgFormat.ident(s));

sql.join = (arr: WithRawSql[]): WithRawSql => sql.raw(arr.map(el => el.rawSql).join(', '));
sql.concat = (arr: WithRawSql[]): WithRawSql => sql.raw(arr.map(el => el.rawSql).join(' '));