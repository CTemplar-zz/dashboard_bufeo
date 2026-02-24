import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { MapContainer, TileLayer, Marker, Popup, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Users,
  Calendar,
  Navigation,
  Waves,
  Activity,
  RefreshCcw,
  MousePointer2,
  Home,
  Layers as LayersIcon,
  Map as MapIcon
} from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { useMap } from 'react-leaflet';

ChartJS.register(ArcElement, Tooltip, Legend);

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons for different types
const getMarkerIcon = (type) => {
  const colors = {
    'Inicio': '#43e97b',
    'Fin': '#F44336',
    'Avistamiento': '#4facfe',
    'Peligro': '#fd79a8'
  };

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${colors[type] || '#888'}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

// Component to auto-fit map bounds
function AutoFitBounds({ points, trigger }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [points, map, trigger]);
  return null;
}

function App() {
  const [trips, setTrips] = useState([]);
  const [points, setPoints] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters State
  const [filterUser, setFilterUser] = useState('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterTrip, setFilterTrip] = useState('all');

  // UI State
  const [chartType, setChartType] = useState('danger');
  const [activeLayers, setActiveLayers] = useState({
    Inicio: true,
    Fin: true,
    Avistamiento: true,
    Peligro: true
  });
  const [baseMap, setBaseMap] = useState('streets');
  const [showControls, setShowControls] = useState({ layers: false, maps: false });
  const [fitTrigger, setFitTrigger] = useState(0); // Trigger manual auto-fit

  useEffect(() => {
    fetchInitialData();
    const unsubscribe = subscribeToUpdates();
    return () => unsubscribe();
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const { data: profileData } = await supabase.from('profiles').select('*');
      setProfiles(profileData || []);
      const { data: tripData } = await supabase.from('trips').select('*').order('start_time', { ascending: false });
      setTrips(tripData || []);
      const { data: pointData } = await supabase.from('trip_data').select('*');
      setPoints(pointData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const subscribeToUpdates = () => {
    const channel = supabase
      .channel('real-time-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_data' }, (payload) => {
        setPoints(prev => [...prev, payload.new]);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trips' }, (payload) => {
        setTrips(prev => [payload.new, ...prev]);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  };

  // Filter Logic
  const filteredPoints = useMemo(() => {
    let result = points;
    if (filterUser !== 'all') {
      const userTripIds = trips.filter(t => t.user_id === filterUser).map(t => t.id);
      result = result.filter(p => userTripIds.includes(p.trip_id));
    }
    if (filterStartDate || filterEndDate) {
      result = result.filter(p => {
        const pDate = parseISO(p.created_at);
        if (filterStartDate && filterEndDate) {
          return pDate >= startOfDay(parseISO(filterStartDate)) && pDate <= endOfDay(parseISO(filterEndDate));
        } else if (filterStartDate) {
          return pDate >= startOfDay(parseISO(filterStartDate));
        } else {
          return pDate <= endOfDay(parseISO(filterEndDate));
        }
      });
    }
    if (filterTrip !== 'all') {
      result = result.filter(p => p.trip_id === filterTrip);
    }
    return result.filter(p => activeLayers[p.type]);
  }, [points, trips, filterUser, filterStartDate, filterEndDate, filterTrip, activeLayers]);

  const filteredTrips = useMemo(() => {
    if (filterUser === 'all') return trips;
    return trips.filter(t => t.user_id === filterUser);
  }, [trips, filterUser]);

  // Statistics
  const stats = useMemo(() => {
    return filteredPoints.reduce((acc, curr) => {
      if (curr.type === 'Avistamiento') {
        acc.adults += (curr.adults || 0);
        acc.calves += (curr.calves || 0);
      } else if (curr.type === 'Peligro') {
        acc.danger += 1;
        const dType = curr.danger_type || 'Desconocido';
        acc.dangerTypes[dType] = (acc.dangerTypes[dType] || 0) + 1;
        const hStatus = curr.health_status || 'Desconocido';
        acc.healthStatus[hStatus] = (acc.healthStatus[hStatus] || 0) + 1;
      }
      return acc;
    }, { adults: 0, calves: 0, danger: 0, dangerTypes: {}, healthStatus: {} });
  }, [filteredPoints]);

  const chartData = useMemo(() => {
    const dataSource = chartType === 'danger' ? stats.dangerTypes : stats.healthStatus;
    const labels = Object.keys(dataSource);
    const data = Object.values(dataSource);
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#ff7eb3', '#4facfe', '#43e97b', '#fd79a8', '#00f2fe'],
        borderWidth: 0,
      }],
    };
  }, [stats, chartType]);

  const toggleLayer = (type) => {
    setActiveLayers(prev => ({ ...prev, [type]: !prev[type] }));
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className="sidebar glass">
        <div className="sidebar-content">
          <div className="stats-grid">
            <div className="stat-card glass">
              <span className="indicator-label">Adultos</span>
              <span className="indicator-val text-green">{stats.adults}</span>
            </div>
            <div className="stat-card glass">
              <span className="indicator-label">Crías</span>
              <span className="indicator-val text-blue">{stats.calves}</span>
            </div>
          </div>

          <div className="stat-card glass danger-card">
            <span className="indicator-label">En Peligro</span>
            <span className="indicator-val text-pink">{stats.danger}</span>
          </div>

          <div className="chart-section glass">
            <div className="chart-header">
              <h3 className="card-header">REPORTE VISUAL</h3>
              <button onClick={() => setChartType(prev => prev === 'danger' ? 'health' : 'danger')} className="refresh-btn">
                <RefreshCcw size={16} />
              </button>
            </div>
            <div className="chart-container">
              {Object.keys(chartType === 'danger' ? stats.dangerTypes : stats.healthStatus).length > 0 ? (
                <Pie data={chartData} options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: 'bottom',
                      labels: {
                        boxWidth: 8,
                        padding: 10,
                        color: '#8b949e',
                        font: { size: 9 }
                      }
                    }
                  }
                }} />
              ) : (
                <span className="no-data">Sin datos en este rango</span>
              )}
            </div>
            <p className="chart-label">
              {chartType === 'danger' ? 'Tipos de Peligro' : 'Estado de Salud'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      < div className="main-content" >
        <header className="filters-header glass">
          <div className="filter-group range-group">
            <div className="range-input">
              <Calendar size={16} className="icon-theme" />
              <input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
            </div>
            <span className="range-sep">al</span>
            <div className="range-input">
              <input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
            </div>
          </div>

          <div className="filter-group select-group">
            <Users size={20} className="icon-theme" />
            <select value={filterUser} onChange={(e) => { setFilterUser(e.target.value); setFilterTrip('all'); }}>
              <option value="all">Todos los usuarios</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name || p.id.split('-')[0]}</option>
              ))}
            </select>
          </div>

          {filterUser !== 'all' && (
            <div className="filter-group select-group">
              <Navigation size={20} className="icon-theme" />
              <select value={filterTrip} onChange={(e) => setFilterTrip(e.target.value)}>
                <option value="all">Todos los viajes</option>
                {filteredTrips.map(t => (
                  <option key={t.id} value={t.id}>{t.start_time ? format(parseISO(t.start_time), 'dd/MM/yyyy HH:mm') : 'Viaje ' + t.id.split('-')[0]}</option>
                ))}
              </select>
            </div>
          )}

          <div className="header-actions">
            <button onClick={fetchInitialData} className="refresh-circle-btn">
              <RefreshCcw size={20} />
            </button>
          </div>
        </header>

        <MapContainer center={[-14.5, -65.0]} zoom={7} className="map-view" zoomControl={false}>
          {baseMap === 'streets' ? (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          ) : (
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          )}

          <AutoFitBounds points={filteredPoints} trigger={fitTrigger} />

          {filteredPoints.map(point => (
            <Marker key={point.id} position={[point.latitude, point.longitude]} icon={getMarkerIcon(point.type)}>
              <Popup className="custom-popup">
                <div className="popup-content">
                  <h4>{point.type}</h4>
                  <p className="popup-date">{point.created_at ? format(parseISO(point.created_at), 'dd/MM/yyyy HH:mm:ss') : ''}</p>
                  {point.type === 'Avistamiento' && (
                    <div className="popup-stats">
                      <div><p className="val text-green">{point.adults}</p><p className="lbl">Adultos</p></div>
                      <div><p className="val text-blue">{point.calves}</p><p className="lbl">Crías</p></div>
                    </div>
                  )}
                  {point.type === 'Peligro' && (
                    <div className="popup-danger">
                      <p className="danger-type">{point.danger_type}</p>
                      {point.health_status && <p className="health-status">Estado: {point.health_status}</p>}
                      {point.photo_url && (
                        <img
                          src={point.photo_url.startsWith('http') ? point.photo_url : supabase.storage.from('bufeo_photos').getPublicUrl(point.photo_url).data.publicUrl}
                          alt="Peligro"
                          onError={(e) => {
                            // Secondary fallback attempt if bucket name was the issue
                            if (!point.photo_url.startsWith('http')) {
                              e.target.src = supabase.storage.from('photos').getPublicUrl(point.photo_url).data.publicUrl;
                            }
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        <div className="status-badge glass">
          <MousePointer2 size={16} className="icon-theme" />
          <span>Puntos: {filteredPoints.length}</span>
          <div className="divider"></div>
          <Activity size={16} className="text-green" />
          <span>En Tiempo Real</span>
        </div>

        {/* Floating Map Controls */}
        <div className="map-actions-panel">
          <button
            onClick={() => setFitTrigger(prev => prev + 1)}
            className="floating-tool-btn glass"
            title="Centrar Mapa"
          >
            <Home size={20} />
          </button>

          <div className="relative-tool">
            <button
              onClick={() => setShowControls(prev => ({ ...prev, layers: !prev.layers, maps: false }))}
              className={`floating-tool-btn glass ${showControls.layers ? 'active' : ''}`}
              title="Capas del Mapa"
            >
              <LayersIcon size={20} />
            </button>
            {showControls.layers && (
              <div className="tool-dropdown glass">
                {Object.entries(activeLayers).map(([type, active]) => (
                  <button key={type} onClick={() => toggleLayer(type)} className={`dropdown-item ${active ? 'active' : ''}`}>
                    <div className="dot" style={{ backgroundColor: getMarkerIcon(type).options.html.match(/background-color: (#\w+)/)[1] }}></div>
                    <span>{type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative-tool">
            <button
              onClick={() => setShowControls(prev => ({ ...prev, maps: !prev.maps, layers: false }))}
              className={`floating-tool-btn glass ${showControls.maps ? 'active' : ''}`}
              title="Tipo de Mapa"
            >
              <MapIcon size={20} />
            </button>
            {showControls.maps && (
              <div className="tool-dropdown glass">
                <button onClick={() => setBaseMap('streets')} className={`dropdown-item ${baseMap === 'streets' ? 'active' : ''}`}>
                  Calles
                </button>
                <button onClick={() => setBaseMap('satellite')} className={`dropdown-item ${baseMap === 'satellite' ? 'active' : ''}`}>
                  Satélite
                </button>
              </div>
            )}
          </div>
        </div>
      </div >
    </div >
  );
}

export default App;
