document.getElementById("savePropertyButton").addEventListener("click", createProperty);

async function createProperty() {
  const message = document.getElementById("addPropertyMessage");

  if (!selectedCustomerId) {
    message.textContent = "Select a customer first.";
    return;
  }

  const street = document.getElementById("addPropertyStreet").value.trim();
  const city = document.getElementById("addPropertyCity").value.trim();
  const state = document.getElementById("addPropertyState").value.trim().toUpperCase();
  const postalCode = document.getElementById("addPropertyPostalCode").value.trim();
  const lockbox = document.getElementById("addPropertyLockbox").value.trim();

  if (!street || !city || !state || !postalCode) {
    message.textContent = "Street, City, State, and Postal Code are required.";
    return;
  }

  message.textContent = "Saving property...";

  const payload = {
    customerId: selectedCustomerId,
    street,
    city,
    state,
    postalCode,
    lockbox
  };

  try {
    const res = await fetch("/api/properties/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await res.text();
    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Invalid JSON from property create API: ${raw || "(empty response)"}`);
    }

    if (!res.ok) {
      throw new Error(data.message || data.error || "Failed to create property.");
    }

    message.textContent = "Property created successfully.";

    // Reload dropdown
    await loadPropertiesForCustomer(selectedCustomerId);

    // Auto-select new property
    selectedPropertyId = String(data.propertyId);
    document.getElementById("propertySelect").value = String(data.propertyId);

    // Hide mini form
    document.getElementById("addPropertyForm").classList.add("hidden");

    // Clear fields
    document.getElementById("addPropertyStreet").value = "";
    document.getElementById("addPropertyCity").value = "";
    document.getElementById("addPropertyState").value = "";
    document.getElementById("addPropertyPostalCode").value = "";
    document.getElementById("addPropertyLockbox").value = "";
  } catch (err) {
    console.error("Create property error:", err);
    message.textContent = err.message || "Failed to create property.";
  }
}
