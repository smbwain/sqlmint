import {Client, Pool, QueryResult, QueryResultRow} from 'pg';
import {WithRawSql} from './sql';

export type QueryFunction = <T extends QueryResultRow = never>(query: WithRawSql<T>) => Promise<QueryResult<T>>;
export type TransactionFunction = <T>(handler: (query: QueryFunction) => Promise<T>) => Promise<T>;

export interface PgWrapper {
    query: QueryFunction;
    transaction: TransactionFunction;
}

export function wrapClient(client: Client): PgWrapper {
    const query = <T extends QueryResultRow>(query: WithRawSql<T>) => client.query<T>(query.rawSql);
    const transaction = async <R>(handler: (query: QueryFunction) => Promise<R>): Promise<R> => {
        try {
            await client.query('BEGIN');
            const res = await handler(<T extends QueryResultRow>(query: WithRawSql<T>) => client.query<T>(query.rawSql));
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
    const query = <T extends QueryResultRow>(query: WithRawSql<T>) => pool.query<T>(query.rawSql);
    const transaction = async <R>(handler: (query: QueryFunction) => Promise<R>): Promise<R> => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const res = await handler(<T extends QueryResultRow>(query: WithRawSql<T>) => client.query<T>(query.rawSql));
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