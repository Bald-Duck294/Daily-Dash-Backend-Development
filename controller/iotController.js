import prisma from "../config/prismaClient.mjs"; // Assuming this is your standard Prisma import

// ==========================================
// POST: Save Sensor Data
// ==========================================
export const saveSensorData = async (req, res) => {
  try {
    const { device_id, nh3_value, status, fan_status, wifi_rssi } = req.body;

    if (!device_id || nh3_value === undefined || !status || !fan_status) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Prepare data object
    const dataToSave = {
      device_id,
      nh3_value,
      status,
      fan_status,
    };

    // NOTE: Only add wifi_rssi if it actually exists in your Prisma schema!
    // If you added `wifi_rssi Int?` to your schema, uncomment the line below:
    // dataToSave.wifi_rssi = wifi_rssi;

    const result = await prisma.odor_readings.create({
      data: dataToSave,
    });

    return res.status(201).json({
      success: true,
      message: "Reading stored successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error saving sensor data:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==========================================
// GET: Fetch All Sensor Data (Limit 100)
// ==========================================
export const getSensorData = async (req, res) => {
  try {
    const result = await prisma.odor_readings.findMany({
      orderBy: { created_at: "desc" },
      take: 100, // Replaces LIMIT 100
    });

    return res.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Error fetching sensor data:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==========================================
// GET: Fetch Latest Reading
// ==========================================
export const getLatestReading = async (req, res) => {
  try {
    const result = await prisma.odor_readings.findFirst({
      orderBy: { created_at: "desc" },
    });

    return res.json({
      success: true,
      data: result || null,
    });
  } catch (error) {
    console.error("Error fetching latest reading:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==========================================
// GET: Fetch Data by Specific Device ID
// ==========================================
export const getDeviceData = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const result = await prisma.odor_readings.findMany({
      where: { device_id: deviceId },
      orderBy: { created_at: "desc" },
      take: 50, // Added a sensible limit
    });

    return res.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error(
      `Error fetching data for device ${req.params.deviceId}:`,
      error,
    );
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ==========================================
// GET: Test API
// ==========================================
export const testIot = async (req, res) => {
  res.json({
    success: true,
    message: "IoT API is working!",
  });
};
