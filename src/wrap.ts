import {Client, Pool, PoolClient, QueryResult, QueryResultRow} from 'pg';
import {WithRawSql} from './sql';

export type QueryFunction = <T extends QueryResultRow = never>(query: WithRawSql<T>) => Promise<QueryResult<T>>;
export type TransactionFunction = <T>(handler: (query: QueryFunction) => Promise<T>) => Promise<T>;

export interface PgWrapper {
    query: QueryFunction;
    transaction: TransactionFunction;
}

const createQueryFunction = (cp: Client | Pool | PoolClient): QueryFunction => async <T extends QueryResultRow = never>(q: WithRawSql<T>) => {
    const res = await cp.query<T>(q.rawSql);
    return q._packF ? {
        ...res,
        rows: res.rows.map(q._packF),
    } : res;
};

export function wrapClient(client: Client): PgWrapper {
    const query = createQueryFunction(client);
    const transaction = async <R>(handler: (query: QueryFunction) => Promise<R>): Promise<R> => {
        try {
            await client.query('BEGIN');
            const res = await handler(createQueryFunction(client));
            await client.query('COMMIT');
            return res;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    };
    return {
        query,
        transaction,
    };
}

export function wrapPool(pool: Pool): PgWrapper {
    const query = createQueryFunction(pool);
    const transaction = async <R>(handler: (query: QueryFunction) => Promise<R>): Promise<R> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const res = await handler(createQueryFunction(client));
            await client.query('COMMIT');
            return res;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    };
    return {
        query,
        transaction,
    };
}