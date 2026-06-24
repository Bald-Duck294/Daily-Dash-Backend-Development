// // utils/serializer.js
// export function serializeBigInt(obj) {
//   if (Array.isArray(obj)) {
//     return obj.map(serializeBigInt);
//   } else if (obj !== null && typeof obj === "object") {
//     const serialized = {};
//     for (const [key, value] of Object.entries(obj)) {
//       if (typeof value === "bigint") {
//         serialized[key] = value.toString();
//       } else if (Array.isArray(value) || (value && typeof value === "object")) {
//         serialized[key] = serializeBigInt(value);
//       } else {
//         serialized[key] = value;
//       }
//     }
//     return serialized;
//   }
//   return obj;
// }

// utils/serializer.js
export function serializeBigInt(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }

  if (typeof obj === "object") {
    const serialized = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeBigInt(value);
    }
    return serialized;
  }

  return obj;
}
