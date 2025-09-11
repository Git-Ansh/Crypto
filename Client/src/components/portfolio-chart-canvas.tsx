import { useRef, useEffect, useState } from 'react';

interface PortfolioChartCanvasProps {
  data: any[];
  timeframe: "1H" | "24H" | "7D" | "30D";
  isMobile?: boolean;
}

export function PortfolioChartCanvas({
  data,
  timeframe,
  isMobile = false,
}: PortfolioChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 300 });

  // Update canvas dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { width } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height: isMobile ? 250 : 300 });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [isMobile]);

  useEffect(() => {
    drawChart();
  }, [data, timeframe, dimensions]);

  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const { width, height } = dimensions;
    const padding = { 
      top: 20, 
      right: isMobile ? 30 : 50, 
      bottom: isMobile ? 40 : 60, 
      left: isMobile ? 60 : 80 
    };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Chart area background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);

    if (data.length < 2) {
      // Show "no data" message
      ctx.fillStyle = '#6b7280';
      ctx.font = isMobile ? '14px Arial' : '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No data available', width / 2, height / 2);
      return;
    }

    // Extract values and timestamps
    const values = data.map(d => d.portfolioValue || d.total || d.value || 0);
    const timestamps = data.map(d => {
      const ts = d.timestamp || d.date;
      return ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    });

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const dataRange = dataMax - dataMin || 0.01; // Minimum range to prevent division by zero

    // ULTRA-AGGRESSIVE dynamic padding for maximum peak/trough visibility (from streaming client)
    let paddingPercent;
    if (dataRange < 1) {
      // For sub-dollar variations, use 300-800% padding for dramatic visibility!
      paddingPercent = Math.max(3.0, Math.min(8.0, 20 / dataRange));
    } else if (dataRange < 10) {
      // For variations under $10, use 150-300% padding
      paddingPercent = Math.max(1.5, Math.min(3.0, 10 / dataRange));
    } else if (dataRange < 100) {
      // For variations under $100, use 75-150% padding
      paddingPercent = Math.max(0.75, Math.min(1.5, 5 / dataRange));
    } else {
      // For larger variations, use standard 20-50% padding
      paddingPercent = Math.max(0.2, Math.min(0.5, dataRange / dataMax));
    }

    const valuePadding = dataRange * paddingPercent;
    const minValue = dataMin - valuePadding;
    const maxValue = dataMax + valuePadding;
    const valueRange = maxValue - minValue;

    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeRange = maxTime - minTime || 1;

    // Draw grid lines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;

    // Horizontal grid lines
    const gridLines = isMobile ? 6 : 8;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartHeight * i / gridLines);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartWidth, y);
      ctx.stroke();

      // Y-axis labels
      ctx.fillStyle = '#6b7280';
      ctx.font = isMobile ? '10px Arial' : '11px Arial';
      ctx.textAlign = 'right';
      const value = maxValue - (valueRange * i / gridLines);

      // Dynamic decimal places based on value range
      const decimals = valueRange < 10 ? 4 : valueRange < 100 ? 3 : 2;
      const labelColor = value === dataMax ? '#10b981' : value === dataMin ? '#ef4444' : '#6b7280';

      ctx.fillStyle = labelColor;
      ctx.fillText(`$${value.toFixed(decimals)}`, padding.left - 10, y + 4);
    }

    // Vertical grid lines
    const verticalLines = isMobile ? 3 : 4;
    for (let i = 0; i <= verticalLines; i++) {
      const x = padding.left + (chartWidth * i / verticalLines);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartHeight);
      ctx.stroke();

      // X-axis labels (time)
      const time = minTime + (timeRange * i / verticalLines);
      const date = new Date(time);

      let timeLabel;
      if (timeframe === '1H') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeframe === '24H') {
        timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (timeframe === '7D') {
        timeLabel = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
      } else if (timeframe === '30D') {
        timeLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }

      ctx.fillStyle = '#6b7280';
      ctx.font = isMobile ? '9px Arial' : '10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(timeLabel || '', x, height - 20);
    }

    // ULTRA-SENSITIVE peak and trough detection (from streaming client)
    const peaks: number[] = [];
    const troughs: number[] = [];

    if (data.length >= 3) {
      for (let i = 1; i < data.length - 1; i++) {
        const prev = values[i - 1];
        const curr = values[i];
        const next = values[i + 1];

        // Use percentage-based comparison for ultra-sensitive detection
        const prevDiff = Math.abs(curr - prev) / Math.max(curr, prev, 0.01);
        const nextDiff = Math.abs(curr - next) / Math.max(curr, next, 0.01);

        // Detect even 0.001% changes as significant peaks/troughs
        if (curr > prev && curr > next && (prevDiff > 0.00001 || nextDiff > 0.00001)) {
          peaks.push(i);
        } else if (curr < prev && curr < next && (prevDiff > 0.00001 || nextDiff > 0.00001)) {
          troughs.push(i);
        }
      }
    }

    // Draw area fill
    ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
    ctx.beginPath();
    
    data.forEach((_, index) => {
      const timestamp = timestamps[index];
      const value = values[index];
      const x = padding.left + ((timestamp - minTime) / timeRange) * chartWidth;
      const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    // Close area to bottom
    const lastX = padding.left + ((timestamps[timestamps.length - 1] - minTime) / timeRange) * chartWidth;
    const firstX = padding.left;
    const bottomY = padding.top + chartHeight;
    
    ctx.lineTo(lastX, bottomY);
    ctx.lineTo(firstX, bottomY);
    ctx.closePath();
    ctx.fill();

    // Draw line
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((_, index) => {
      const timestamp = timestamps[index];
      const value = values[index];
      const x = padding.left + ((timestamp - minTime) / timeRange) * chartWidth;
      const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Draw data points with enhanced styling for peaks/troughs
    data.forEach((_, index) => {
      const timestamp = timestamps[index];
      const value = values[index];
      const x = padding.left + ((timestamp - minTime) / timeRange) * chartWidth;
      const y = padding.top + chartHeight - ((value - minValue) / valueRange) * chartHeight;

      const isPeak = peaks.includes(index);
      const isTrough = troughs.includes(index);
      const isMax = value === dataMax;
      const isMin = value === dataMin;

      if (isMax || isPeak) {
        // Peak markers - green triangles
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x - 4, y + 2);
        ctx.lineTo(x + 4, y + 2);
        ctx.closePath();
        ctx.fill();
      } else if (isMin || isTrough) {
        // Trough markers - red triangles
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x - 4, y - 2);
        ctx.lineTo(x + 4, y - 2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Regular data points
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    });

    // Chart title
    const timeFrameInfo = {
      '1H': { label: '1 Hour', resolution: '5min intervals' },
      '24H': { label: '24 Hours', resolution: '30min intervals' },
      '7D': { label: '7 Days', resolution: '1hr intervals' },
      '30D': { label: '30 Days', resolution: '12hr intervals' }
    }[timeframe] || { label: '24 Hours', resolution: '30min intervals' };

    ctx.fillStyle = '#1f2937';
    ctx.font = isMobile ? 'bold 14px Arial' : 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Portfolio History - ${timeFrameInfo.label}`, width / 2, 18);

    // Statistics
    const stats = `${data.length} points | Range: $${(dataMax - dataMin).toFixed(2)} | Peaks: ${peaks.length} | Troughs: ${troughs.length}`;
    ctx.fillStyle = '#6b7280';
    ctx.font = isMobile ? '9px Arial' : '11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(stats, width / 2, 35);

    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#6b7280';
    ctx.font = isMobile ? '10px Arial' : '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Portfolio Value ($)', 0, 0);
    ctx.restore();

    // Value annotations
    ctx.fillStyle = '#10b981';
    ctx.font = isMobile ? '10px Arial' : 'bold 11px Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`MAX: $${dataMax.toFixed(2)}`, width - padding.right + 45, padding.top + 15);

    ctx.fillStyle = '#ef4444';
    ctx.fillText(`MIN: $${dataMin.toFixed(2)}`, width - padding.right + 45, padding.top + 30);

    // Calculate and display trend information
    if (data.length >= 2) {
      const firstValue = values[0];
      const lastValue = values[values.length - 1];
      const totalChange = lastValue - firstValue;
      const percentChange = ((totalChange / firstValue) * 100);

      const trendColor = totalChange >= 0 ? '#10b981' : '#ef4444';
      const trendSymbol = totalChange >= 0 ? '↗' : '↘';

      ctx.fillStyle = trendColor;
      ctx.font = isMobile ? '10px Arial' : 'bold 11px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`${trendSymbol} ${percentChange.toFixed(2)}%`, width - padding.right + 45, padding.top + 45);
      ctx.font = isMobile ? '8px Arial' : '9px Arial';
      ctx.fillText(`(${totalChange >= 0 ? '+' : ''}$${totalChange.toFixed(2)})`, width - padding.right + 45, padding.top + 58);
    }

    // Legend
    ctx.textAlign = 'left';
    ctx.font = isMobile ? '9px Arial' : '10px Arial';
    const legendY = padding.top + 15;

    // Peak legend
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(padding.left + 10, legendY - 3);
    ctx.lineTo(padding.left + 6, legendY + 3);
    ctx.lineTo(padding.left + 14, legendY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Peaks', padding.left + 20, legendY + 2);

    // Trough legend
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(padding.left + 70, legendY + 3);
    ctx.lineTo(padding.left + 66, legendY - 3);
    ctx.lineTo(padding.left + 74, legendY - 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b7280';
    ctx.fillText('Troughs', padding.left + 80, legendY + 2);
  };

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No portfolio data available
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full border border-gray-200 rounded-lg bg-white"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}
