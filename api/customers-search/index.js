const result = await db.request()
  .input("q", sql.NVarChar(200), `%${req.query.q}%`)
  .query(`
    SELECT TOP 20 CustomerId, Name
    FROM dbo.Customers
    WHERE Name LIKE @q
    ORDER BY Name
  `);

context.res = {
  status: 200,
  body: result.recordset
};
