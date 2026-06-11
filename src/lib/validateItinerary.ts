import type { FlightInfo } from "@/lib/schemas";
import type { Itinerary } from "@/types/itinerary";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  day?: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function calcExpectedDays(departureDate: string, returnDate: string): number {
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);
  return Math.max(1, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

export function validateItinerary(
  itinerary: Itinerary,
  flightInfo: FlightInfo,
  arrivalCityName: string,
  returnCityName: string,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { days } = itinerary;
  const expectedDays = calcExpectedDays(flightInfo.departureDate, flightInfo.returnDate);
  const isMultiCity = arrivalCityName !== returnCityName;

  // Day count
  if (days.length !== expectedDays) {
    issues.push({
      severity: "error",
      code: "DAY_COUNT_MISMATCH",
      message: `行程有 ${days.length} 天，但航班日期區間應為 ${expectedDays} 天`,
    });
  }

  // Day number sequence
  const dayNumbers = days.map((d) => d.day);
  for (let i = 0; i < dayNumbers.length; i++) {
    if (dayNumbers[i] !== i + 1) {
      issues.push({
        severity: "error",
        code: "DAY_NUMBER_SEQUENCE",
        message: `day 編號不連續：第 ${i + 1} 個元素的 day 值為 ${dayNumbers[i]}，應為 ${i + 1}`,
        day: dayNumbers[i],
      });
    }
  }

  const transitDays = days.filter((d) => d.isTransitDay);

  // Transit day presence
  if (isMultiCity && transitDays.length === 0) {
    issues.push({
      severity: "error",
      code: "TRANSIT_DAY_MISSING",
      message: `多城市行程（${arrivalCityName} → ${returnCityName}）缺少移動日（isTransitDay: true）`,
    });
  }

  if (!isMultiCity && transitDays.length > 0) {
    issues.push({
      severity: "error",
      code: "TRANSIT_DAY_UNEXPECTED",
      message: `單城市行程不應有移動日，但找到 ${transitDays.length} 個 isTransitDay: true 的天`,
    });
  }

  if (isMultiCity && transitDays.length > 1) {
    issues.push({
      severity: "error",
      code: "TRANSIT_DAY_DUPLICATE",
      message: `移動日只能有一天，但找到 ${transitDays.length} 個`,
    });
  }

  // Transit day details
  for (const td of transitDays) {
    if (!td.transitTo) {
      issues.push({
        severity: "error",
        code: "TRANSIT_DAY_NO_TRANSITTO",
        message: `第 ${td.day} 天（移動日）缺少 transitTo 欄位`,
        day: td.day,
      });
    } else if (td.transitTo !== returnCityName) {
      issues.push({
        severity: "error",
        code: "TRANSIT_DAY_WRONG_CITY",
        message: `第 ${td.day} 天（移動日）的 transitTo 為「${td.transitTo}」，應為「${returnCityName}」`,
        day: td.day,
      });
    }

    if (td.accommodation != null) {
      issues.push({
        severity: "warning",
        code: "TRANSIT_DAY_HAS_ACCOMMODATION",
        message: `第 ${td.day} 天（移動日）不應有住宿，但 accommodation 不為 null`,
        day: td.day,
      });
    }
  }

  const lastDay = days[days.length - 1];

  // Accommodation per day
  for (const day of days) {
    const isLast = day.day === days.length;
    const isTransit = day.isTransitDay === true;

    if (!isLast && !isTransit && !day.accommodation) {
      issues.push({
        severity: "error",
        code: "ACCOMMODATION_MISSING",
        message: `第 ${day.day} 天缺少住宿（accommodation 為 null 或未填）`,
        day: day.day,
      });
    }

    if (isLast && day.accommodation != null) {
      issues.push({
        severity: "warning",
        code: "LAST_DAY_HAS_ACCOMMODATION",
        message: `最後一天（第 ${day.day} 天）不需要住宿，但 accommodation 有值`,
        day: day.day,
      });
    }
  }

  // Per-day content checks
  for (const day of days) {
    const isTransit = day.isTransitDay === true;

    if (!isTransit && day.stops.length < 2) {
      issues.push({
        severity: "warning",
        code: "DAY_TOO_FEW_STOPS",
        message: `第 ${day.day} 天只有 ${day.stops.length} 個景點，建議至少 2 個`,
        day: day.day,
      });
    }

    if (!day.meals || (!day.meals.breakfast && !day.meals.lunch && !day.meals.dinner)) {
      issues.push({
        severity: "warning",
        code: "DAY_MISSING_MEALS",
        message: `第 ${day.day} 天缺少餐廳推薦`,
        day: day.day,
      });
    }

    if (day.stops.length >= 2) {
      const timesOfDay = day.stops.map((s) => s.time_of_day).filter(Boolean);
      const unique = new Set(timesOfDay);
      if (timesOfDay.length === day.stops.length && unique.size === 1) {
        issues.push({
          severity: "warning",
          code: "STOPS_ALL_SAME_TIME",
          message: `第 ${day.day} 天所有景點的 time_of_day 都是「${[...unique][0]}」，分配可能不合理`,
          day: day.day,
        });
      }
    }
  }

  // First day: flight arrival time constraint
  if (flightInfo.arrivalTime && days.length > 0) {
    const firstDay = days[0];
    const firstStop = firstDay.stops[0];
    if (firstStop?.time_of_day === "morning") {
      const [h] = flightInfo.arrivalTime.split(":").map(Number);
      if (h >= 14) {
        issues.push({
          severity: "warning",
          code: "FIRST_DAY_ARRIVAL_CONFLICT",
          message: `去程 ${flightInfo.arrivalTime} 抵達，但第 1 天第一個景點標記為上午，時間可能衝突`,
          day: 1,
        });
      }
    }
  }

  // Last day: flight departure time constraint
  if (flightInfo.returnDepartureTime && lastDay) {
    const lastStop = lastDay.stops[lastDay.stops.length - 1];
    if (lastStop?.time_of_day === "evening") {
      const [h] = flightInfo.returnDepartureTime.split(":").map(Number);
      if (h <= 15) {
        issues.push({
          severity: "warning",
          code: "LAST_DAY_DEPARTURE_CONFLICT",
          message: `回程 ${flightInfo.returnDepartureTime} 出發，但最後一天仍有晚上景點，可能來不及`,
          day: lastDay.day,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  return {
    valid: errors.length === 0,
    issues,
  };
}
