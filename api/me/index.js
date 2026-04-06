const { getPool, sql } = require("../shared/db");

module.exports = async function (context, req) {
  try {
    // --- 1. Get Azure AD identity ---
    const clientPrincipalHeader = req.headers["x-ms-client-principal"];

    if (!clientPrincipalHeader) {
      context.res = {
        status: 401,
        body: { error: "Not authenticated" }
      };
      return;
    }

    const decoded = JSON.parse(
      Buffer.from(clientPrincipalHeader, "base64").toString("ascii")
    );

    const aadObjectId = decoded.userId;
    const email = decoded.userDetails;

    // Try to get name from claims
    let displayName = email;

    const nameClaim = decoded.claims?.find(c => c.typ === "name");
    if (nameClaim && nameClaim.val) {
      displayName = nameClaim.val;
    }

    if (!aadObjectId) {
      context.res = {
        status: 400,
        body: { error: "Invalid identity" }
      };
      return;
    }

    // --- 2. Get DB connection ---
    const pool = await getPool();

    // --- 3. Check if profile exists ---
    const existing = await pool.request()
      .input("AadObjectId", sql.NVarChar(100), aadObjectId)
      .query(`
        SELECT TOP 1 *
        FROM dbo.EmployeeProfiles
        WHERE AadObjectId = @AadObjectId
      `);

    let profile;

    if (existing.recordset.length > 0) {
      profile = existing.recordset[0];
    } else {
      // --- 4. Create new profile ---
      const insertResult = await pool.request()
        .input("AadObjectId", sql.NVarChar(100), aadObjectId)
        .input("Email", sql.NVarChar(255), email)
        .input("DisplayName", sql.NVarChar(200), displayName)
        .query(`
          INSERT INTO dbo.EmployeeProfiles
          (
            AadObjectId,
            Email,
            DisplayName
          )
          OUTPUT INSERTED.*
          VALUES
          (
            @AadObjectId,
            @Email,
            @DisplayName
          )
        `);

      profile = insertResult.recordset[0];
    }

    // --- 5. Return profile to UI ---
    context.res = {
      status: 200,
      body: {
        ok: true,
        user: {
          employeeProfileId: profile.EmployeeProfileId,
          aadObjectId: profile.AadObjectId,
          email: profile.Email,
          displayName: profile.DisplayName,
          employeeType: profile.EmployeeType,
          timeEntryMode: profile.TimeEntryMode,
          canApproveTime: profile.CanApproveTime,
          isTechnician: profile.IsTechnician,
          isOfficeStaff: profile.IsOfficeStaff,
          isActive: profile.IsActive
        }
      }
    };

  } catch (err) {
    context.log.error("api/me error", err);

    context.res = {
      status: 500,
      body: {
        error: "Failed to load user",
        details: err.message
      }
    };
  }
};