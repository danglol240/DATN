import React from 'react';

export default function MetricCard({ title, value, subtitle }) {
  return (
    <div className="bg-[#1C1D24] p-5 rounded-lg border border-gray-800 shadow-md flex flex-col justify-between">
      <h3 className="text-gray-400 text-sm font-medium mb-2">{title}</h3>
      {subtitle && <span className="text-xs text-gray-500 mb-1">{subtitle}</span>}
      <div className="text-4xl font-light text-white tracking-wide mt-auto">
        {value}
      </div>
    </div>
  );
}
