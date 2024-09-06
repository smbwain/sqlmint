sqlmint
-------

Small, expressive, injection-safe and typescript friendly template engine for postgres sql queries

![alt text](./doc/logo.png "Title")

- [What does it allow me to do?](#what-does-it-allow-me-to-do)
- [Serialization rules](#serialization-rules)
- [Helpers](#helpers)
  - [and](#and)
  - [or](#or)
  - [set](#set)
  - [insert](#insert)
  - [multiInsert](#multiInsert)
  - [array](#array)
  - [list](#list)
  - [ident](#ident)
  - [raw](#raw)
- [Roadmap](#roadmap)
- [Licence](#license)

# What does it allow me to do?

- __It allows you to build sql queries__

  Main function of the _sqlmint_ is [sql](#sql-tag). It's a javaScript tag function, which allows you to build sql queries.

  You can put your javaScript variables and expressions inside. It will be automatically serialized.

  ```ts
  import {sql} from 'sqlmint';
  
  const email = 'name@example.com';
  
  sql`SELECT * FROM users WHERE email=${email}` // -> SELECT * FROM users WHERE email='name@example.com'
  ```

- __It has useful helpers__ 

  There are some useful [helpers](#helpers) to build some common pieces of sql like [and condition](#and), [INSERT INTO ... VALUES](#insert) or [UPDATE ... SET](#set).

  Anyway __it's not an ORM__. You still work with SQL and this library doesn't hide a power of it by additional layers.
  
- __It's safe__

  Although `sql` function is a tag function (sometimes called a string template), the result of its execution is not a string.

  The result is an instance of some special WithRawSql class. It allows sqlmint to distinguish between regular unsafe strings (which should be serialized when used in template) and already processed parts of sql, which should be placed as raw sql when placed into template.

  So even if you forgot to use _sql_ tag somewhere in your query, it would be escaped as regular string than.

- __It's ready to go with pg library__

  For you convenience, there are ready to go wrapper for pg.Pool which allows you to make queries and transactions:

  ```ts
  import {Pool, types} from 'pg';
  import {wrapPool} from 'sqlmint';
  
  const pgPool = new Pool();
  const {query, transaction} = wrapPool(pgPool);
  
  // ...
  
  const {rows} = await query(sql`SELECT * FROM users WHERE id=${userId}`);
  
  // ...
  
  await transaction(async query => {
      // we are inside a transaction here
      await query(sql`
          UPDATE users
          SET ${sql.set({
              active: false,
              updatedAt: Date.now(),
          })}
          WHERE id=${userId}
      `);
      await query(sql`
          INSERT INTO history
          ${sql.insert({
              type: 'set-user-activity',
              userId,
          })}
      `);
  });
  ```
  
- __It plays nice with typescript__

  If you use typescript, it could be pain to make types for sql results.

  sqlmint allows you to describe type of your query using generic parameter of sql tag.

  ```ts
  const {rows} = await query(sql<{cnt: number}>`
    SELECT COUNT(*) AS cnt FROM users
  `);
  
  rows[0].cnt // <- typescript knows, that it's a number
  ```
  
  Or one more example:

  ```ts
  interface User {
    id: string;
    email: string;
    role: 'admin' | 'seller' | 'buyer';
  }
  
  const loadUserQuery = (id: number) => sql<User>`SELECT * FROM users WHERE id=${id}`;
                                         // ^ query has type definition here
  
  const {rows: [user]} = await query(loadUserQuery(1));
             // ^ here typescript knows that user extends User interface 
  ```
  
- __It allows you to extend serialization algorithm for your custom types__

  Out of the box, when you put data into a template it automatically serialized. It works well for strings, boolean, arrays, Date and so on...
  But sometimes you want to add your own rules of serialization.

  E.g. you want ot use `luxon` library to work with dates, and you want to be able to put luxon dates into a sql query.

  You can add some configuration to sqlmint:

  ```ts
  import {DateTime} from 'luxon';
  import {config, serialize} from 'sqlmint';
  
  config.customSerialize = (v: any) => {
    if (DateTime.isDateTime(v)) {        // if data is recognized as luxon DateTime
        return serialize(v.toSQL());     // convert it to a string, and use default serializer (which escapes string)
    }
    return null; 
  }
  
  // now you can put luxon DateTime into sql queries:
  
  await query(sql`
    SELECT * FROM users WHERE created_at > ${DateTime.now()}
  `)
  
  ```
  
# Serialization rules

Serialization of each value is processed in the following order:

- Try customSerialize method
- If data is instance of WithRawSql class, use its rawSql property (sql tag and [helpers](#helpers) returns instance of WithRawSql)
- If data is array, [list](#list) helper is used to serialize it
-  [pg-format](https://www.npmjs.com/package/pg-format) library used to serialize  

# Helpers

## and

Combines few sql conditions using `AND` operator. It ignores `null` and `undefined` values, which allows to add optional conditions easily.

```
const loadUsersQuery = (filter: {
    isActive?: boolean,
    roles: Array<'admin' | 'seller' | 'buyer'>,
    createdAfter?: Date;
} = sql`
    SELECT * FROM users WHERE ${sql.and([
        filter.isActive ? sql`active=TRUE` : null,
        filter.roles ? sql`role IN ${filter.roles}` : null,
        filter.createdAfter ? sql`created > ${filter.createdAfter}` : null,
    ])}
`;

loadUsersQuery({isActive: true})
  // -> SELECT * FROM users WHERE active=TRUE
  
loadUsersQuery({
    roles: ['admin', 'seller'],
    createdAfter: new Date(),
})
  // -> SELECT * FROM users WHERE (role IN ('admin', 'seller')) AND (created > '2022-04-22 10:34:23.55')
```

By default, if all conditions contain nulls, error will be thrown. If you want to override this behaviour, use second parameter. It describes a fallback condition for the case no other conditions were passed.

```
const loadUsersQuery = (filter: {
    isActive?: boolean,
    roles: Array<'admin' | 'seller' | 'buyer'>,
    createdAfter?: Date;
} = sql`
    SELECT * FROM users WHERE ${sql.and([
        filter.isActive ? sql`active=TRUE` : null,
        filter.roles ? sql`role IN ${filter.roles}` : null,
        filter.createdAfter ? sql`created > ${filter.createdAfter}` : null,
    ], sql`TRUE`)}
    
loadUsersQuery({isActive: true})
  // -> SELECT * FROM users WHERE active=TRUE
  
loadUsersQuery({})
  // -> SELECT * FROM users WHERE TRUE
`;
```

## or

The similar as [and](#and) helper, but combines conditions using OR operator.

## set

This helper is useful to build SET section of UPDATE queries. It recursively serializes all passed values.

It ignores undefined values, so it's very convinient to do different partial updates using the same query.

It throws error, if there is no any value to set.

```
const updateUserQuery = (id: number, data: {
    name?: string;
    age?: number;
}) => sql`
    UDPATE users
    SET ${sql.set({
        name,
        age,
        modified_at: new Date(),
    })}
    WHERE id=${id}
`;

updateUserQuery(1, {name: 'Roman', age: 35})
   // -> UPDATE users SET name='Roman', age=35, modified_at='2022-04-22 10:34:23.55' WHERE id=1
   
updateUserQuery(1, {age: 19})
   // -> UPDATE users SET age=19, modified_at='2022-04-22 10:34:23.55' WHERE id=1
```

## insert

It helps to build insert queries

```
sql`INSERT INTO users ${sql.insert({
    name: 'Roman',
    age: 35,
})}`
// -> INSERT INTO users (name, age) VALUES ('Roman', 35)
```

## multiInsert

It helps to build multi insert queries

```
sql`INSERT INTO users ${sql.multiInsert([{
    name: 'Roman',
    age: 35,
}, {
    name: 'John',
    age: 42,
}])}`
// -> INSERT INTO users (name, age) VALUES ('Roman', 35), ('John', 42)
```

## array

Serializes array of items using `ARRAY[...]` notation. Recursively serializes each element.

```
sql`SELECT ${sql.array(['1', '2', '3'])}` // -> SELECT ARRAY['1', '2', '3']
```

```
sql`SELECT ${sql.array([])}::int[]` // -> SELECT ARRAY[]::int[]
```

## list

Serializes array of items using `(...)` notation. Recursively serializes each element.

```
const arr = [1, 2, 3];
sql`SELECT * FROM users WHERE id IN ${sql.list(arr)}` // -> SELECT * FROM users WHERE id IN (1, 2, 3)
```

> Actually default behaviour of serializer is to treat array as a list. So usually you can just pass an array without _list_ helper:
> ```
> const arr = [1, 2, 3];
> sql`SELECT * FROM users WHERE id IN ${arr}` // -> SELECT * FROM users WHERE id IN (1, 2, 3)
> ```

## ident

Usually you just put postgres identificators (like names of tables or columns) in your sql templates as is.

But if you want to put name from variable or expression, you may want to use `sql.ident` helper to serialize identifier name.

```
const table = 'user';

sql`SELECT * FROM ${sql.ident(table)}`
```

## raw

You can use this helper to wrap raw sql string into WithRawSql object.

It's not something you usually want to use, as you can use sql tag to write your sql.

# Roadmap

- improve documentation
- add examples

# License

ISC

Copyright 2021 Roman Ditchuk

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.