import prisma from "../config/prismaClient.mjs";
import {
  parsePaginationParams,
  paginateWithPrisma,
} from "../utils/pagination.js";
import { serializeBigInt } from "../utils/serializer.js";

export const getAllCompanies = async (req, res) => {
  // 1. Parse query parameters with fallbacks
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 6;

  // 2. Calculate how many records to skip
  const skip = (page - 1) * limit;

  try {
    // 3. Fetch ONLY the requested page of data
    const companies = await prisma.companies.findMany({
      skip: skip,
      take: limit,
      orderBy: {
        created_at: "desc",
      },
    });

    // 4. Return the data and basic local pagination info
    res.status(200).json({
      data: serializeBigInt(companies), // Retaining your BigInt serializer
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({ message: "Failed to fetch companies" });
  }
};

export const getCompaniesCount = async (req, res) => {
  try {
    const totalCount = await prisma.companies.count({
      where: {
        deleted_at: null,
      },
    });

    res.status(200).json({ totalCount, success: true });
  } catch (error) {
    console.error("Error fetching count:", error);
    res.status(500).json({ message: "Failed to fetch count" });
  }
};

export const createCompany = async (req, res) => {
  try {
    const { name, description, contact_email } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Company name is required" });
    }

    const newCompany = await prisma.companies.create({
      data: {
        name,
        description,
        contact_email,
      },
    });

    res.status(201).json(serializeBigInt(newCompany));
  } catch (error) {
    console.error("Error creating company:", error);
    res.status(500).json({ message: "Failed to create company" });
  }
};

// @desc    Get a single company by ID
// @route   GET /api/companies/:id
// @access  Public
export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.companies.findUnique({
      where: { id: parseInt(id) },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(200).json(serializeBigInt(company));
  } catch (error) {
    console.error("Error fetching company:", error);
    res.status(500).json({ message: "Failed to fetch company" });
  }
};

// @desc    Update a company
// @route   POST /api/companies/:id
// @access  Public
export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, contact_email } = req.body;

    console.log(req.body, "req body");

    if (!name) {
      return res.status(400).json({ message: "Company name is required" });
    }

    const updatedCompany = await prisma.companies.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        contact_email,
        updated_at: new Date(),
      },
    });

    res.status(200).json(serializeBigInt(updatedCompany));
  } catch (error) {
    console.error("Error updating company:", error);
    if (error.code === "P2025") {
      // Prisma code for record not found
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(500).json({ message: "Failed to update company" });
  }
};

// @desc    Delete a company
// @route   DELETE /api/companies/:id
// @access  Public
export const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.companies.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send(); // No Content
  } catch (error) {
    console.error("Error deleting company:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(500).json({ message: "Failed to delete company" });
  }
};

// controllers/companyController.js

export const setupCompany = async (req, res) => {
  try {
    // 1. SAFELY HANDLE VERCEL'S STRINGIFIED BODY BEHAVIOR
    let payload = req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        console.error("Failed to parse stringified body on Vercel:", e);
      }
    }

    // 2. DESTRUCTURE FROM THE SAFELY PARSED PAYLOAD
    const { organization_name, organization_type, operation_structure } =
      payload || {};
    const companyId = req.user?.company_id;

    console.log("Vercel Debug - Extracted Data:", {
      organization_name,
      organization_type,
      operation_structure,
      companyId,
    });

    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    // 3. CHECK FOR MISSING FIELDS
    if (!organization_name || !organization_type || !operation_structure) {
      // 🚨 FIX: Removed 'console.log(error)' which causes a ReferenceError
      return res.status(400).json({
        error: "All fields are required.",
        // Send back the payload Vercel received so you can see it in your Frontend Network tab!
        debug_vercel_payload: payload,
      });
    }

    // 4. UPDATE DATABASE
    const updatedCompany = await prisma.companies.update({
      where: { id: BigInt(companyId) },
      data: {
        name: organization_name,
        onboarding_metadata: {
          organization_type,
          operation_structure,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: "Company profile updated successfully",
      data: serializeBigInt(updatedCompany),
    });
  } catch (error) {
    console.error("Company Setup Error:", error);
    res.status(500).json({ error: "Failed to save company profile" });
  }
};

// controllers/companyController.js

export const getOnboardingStatus = async (req, res) => {
  console.log("Fetching onboarding status for user:", req.user);
  try {
    const companyId = req.user.company_id;
    if (!companyId) {
      return res
        .status(400)
        .json({ message: "No company associated with this user." });
    }

    const company = await prisma.companies.findUnique({
      where: { id: BigInt(companyId) },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found." });
    }
    const locationCount = await prisma.locations.count({
      where: {
        company_id: BigInt(companyId),
        deleted_at: null,
      },
    });

    const hasWorkspace =
      locationCount > 0 || Boolean(company.is_onboarding_completed); // Check if profile is complete (Name is set and not default, metadata exists)
    const hasProfile =
      company.name &&
      company.name !== "Pending Setup" &&
      company.onboarding_metadata;

    // const isCompleted = company.is_onboarding_completed;

    let nextStep = "dashboard";
    // if (!isCompleted) {
    //   if (!hasProfile) {
    //     nextStep = "company";
    //   } else {
    //     nextStep = "workspace";
    //   }
    // }

    if (!hasWorkspace) {
      if (!hasProfile) nextStep = "company";
      else nextStep = "workspace";
    }
    res.status(200).json({
      companyProfileCompleted: Boolean(hasProfile),
      workspaceExists: hasWorkspace,
      isOnboardingCompleted: Boolean(company.is_onboarding_completed),
      nextStep,
    });
  } catch (error) {
    console.error("Error fetching onboarding status:", error);
    res.status(500).json({ message: "Failed to fetch onboarding status" });
  }
};
