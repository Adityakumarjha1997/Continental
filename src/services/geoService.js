'use strict'; 
 
/** 
* Geolocation helpers. Uses the Haversine formula to measure the distance 
* between two lat/lng points in metres. This is what enforces the "must be 
* within N metres of the restaurant to order" rule. 
*/ 
function distanceMeters(a, b) { 
  const R = 6371000; // Earth radius in metres 
  const toRad = (d) => (d * Math.PI) / 180; 
  const dLat = toRad(b.lat - a.lat); 
  const dLng = toRad(b.lng - a.lng); 
  const lat1 = toRad(a.lat); 
  const lat2 = toRad(b.lat); 
  const h = 
    Math.sin(dLat / 2) ** 2 + 
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2; 
  return 2 * R * Math.asin(Math.sqrt(h)); 
} 
 
function isWithin(center, point, radiusMeters) { 
  return distanceMeters(center, point) <= radiusMeters; 
} 
 
module.exports = { distanceMeters, isWithin }; 
 

 
