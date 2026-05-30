import express from "express";
// import { getUser } from '../controller/getDataController.js';
import {
  createUser,
  deleteUser,
  getUser,
  getclientUser,
  getUsersCount,
  updateUser,
  getUserById,
  changeOwnPassword,
} from "../controller/userController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const userRouter = express.Router();

userRouter.get("/", verifyToken, getUser);
userRouter.get("/client", verifyToken, getclientUser);
userRouter.get("/count", verifyToken, getUsersCount);
userRouter.get("/:id", getUserById);
userRouter.post("/", createUser);
userRouter.post("/:id", updateUser);
userRouter.delete("/:id", deleteUser);
userRouter.patch("/change-password", changeOwnPassword);
export default userRouter;
